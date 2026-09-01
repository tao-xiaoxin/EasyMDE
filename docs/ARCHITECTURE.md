# EasyMDE Architecture

EasyMDE is a standalone WordPress plugin wired from `easymde.php` into `EasyMDE\Plugin`. The global `EasyMDE_Plugin` class remains as a compatibility facade for existing extension code.

This document describes the current implementation boundaries. Approved target decisions for the React, TypeScript, and Vite admin applications live in [Design](DESIGN.md); that document does not claim that target paths already exist. Development setup lives in [Development](DEVELOPMENT.md), and release validation lives in [Testing and Release](TESTING_AND_RELEASE.md).

## Issue #91 Direct React Cutover

The maintainer-approved target for the ordinary WordPress Editor is one React 18 Editor Root, with PHP enqueuing a Vite loader that dynamically loads its hashed main entry. This is a direct cutover, not another sequence of Legacy-to-React runtime handoffs. The final ordinary Editor does not enqueue or execute `assets/js/admin/bootstrap.js`, jQuery, the Legacy Toolbar, Preview, Theme, Draft, Media runtimes, Legacy fallback DOM, or Focus Mode / immersive-writing assets.

The React Root preserves the ordinary editing capability matrix from Issues
#91 and #86 while WordPress-native surfaces continue to own publishing and
revisions:

- title and Markdown editing, Selection, IME, Undo/Redo, shortcuts, and every
  registered Toolbar command;
- live server Preview, GFM tables and task lists, Mermaid, KaTeX, Highlight.js,
  TOC, synchronized scrolling, themes, fonts, and Custom CSS;
- WordPress Media selection, Paste/Drop upload, Local Draft recovery, WeChat
  export, and the fixed Source/Preview workspace;
- the native WordPress form and unknown extension fields, permissions, Nonces,
  locks, failure states, responsive layouts, RTL, and accessibility;
- WordPress-native Publish, category, tag, excerpt, featured-image, and Revision
  Meta Boxes and screens outside the React Root.

PHP and WordPress retain their existing data, authorization, rendering, native
form, Save, Publish, Revision, Media, and security authority. `_easymde_markdown`
remains canonical Markdown and `post_content` remains compatibility HTML.
Focus Mode is not part of the default ordinary-editor surface, and the ordinary toolbar provides the entry into Issue #126's immersive presentation within the same Root. The immersive presentation reuses the ordinary CodeMirror, Preview, native form, and WordPress capability owners. The ordinary workspace has one restrained footer for the live Markdown character count and WordPress-owned last-editor timestamp. Immersive Outline, expanded writing statistics, and view switching remain scoped to the immersive presentation; Publish and Revision controls delegate to the existing WordPress owners.

The ordinary Editor now follows this single-Root boundary in the live branch.
Legacy admin Browser Runtime files and Focus Mode assets have no ordinary
Editor consumer and are excluded from the release package. Historical data and
public PHP compatibility contracts remain preserved as described below.

## Repository Structure

```text
.
|-- easymde.php                         # Root plugin bootstrap, metadata, and version declaration.
|-- uninstall.php                       # WordPress uninstall entry point and cleanup handling.
|-- readme.txt                          # WordPress plugin-directory metadata and readme content.
|-- README.md                           # Primary project documentation entry point.
|-- README.en.md                        # English project documentation entry point.
|-- AGENTS.md                           # Owner of repository-wide invariants and guidance ownership.
|-- CONTRIBUTING.md                     # Public contribution workflow and review guidance.
|-- SECURITY.md                         # Vulnerability reporting and security guidance.
|-- UPGRADING.md                        # User-facing upgrade and rollback guidance.
|-- THIRD-PARTY-NOTICES.md              # Notices for bundled runtime dependencies and assets.
|-- LICENSE                              # Project license.
|-- includes/                            # Legacy global compatibility classes and standalone helpers.
|-- src/                                 # Namespaced PHP implementation modules.
|   |-- Plugin.php                       # Service wiring and module registration.
|   |-- Admin/                           # Admin screens, post gating, settings, assets, and save handling.
|   |-- Content/                         # Markdown rendering, document state, TOC, transforms, and revisions.
|   |-- Frontend/                        # Public content filtering and conditional frontend asset loading.
|   |-- ImageHosting/                    # Image-hosting providers, signing, upload orchestration, and runtime policy.
|   |-- Rest/                            # `easymde/v1` REST controllers and request boundaries.
|   |-- Support/                         # Shared capabilities, options, migration, assets, toolbar, and facade support.
|   `-- Theme/                           # Article/code theme registries, fonts, state, and Custom CSS policy.
|-- templates/                           # PHP-rendered templates.
|   `-- admin/                           # Prepared-data admin templates without business rules.
|-- frontend/                            # TypeScript, React, CodeMirror, Vite, and frontend test-contract sources.
|   |-- src/                             # Browser application source organized by architectural layer.
|   |   |-- app/                         # React roots, error boundaries, and top-level composition.
|   |   |   |-- editor/                  # Ordinary Editor Root composition.
|   |   |   `-- settings/                # Independent Settings Center Root composition.
|   |   |-- contracts/                   # Bootstrap data, Ports, Results, and runtime contracts.
|   |   |   |-- bootstrap/               # WordPress-to-browser bootstrap schemas and fixtures.
|   |   |   `-- ports/                   # Feature and integration interfaces.
|   |   |-- domain/                      # Pure editor rules without React, DOM, WordPress, network, or storage access.
|   |   |-- entrypoints/                 # Screen/runtime discovery, mounting, readiness, and teardown boundaries.
|   |   |-- features/                    # User-recognizable editor and administration capabilities.
|   |   |-- generated/                   # Checked-in generated browser source produced by local tooling.
|   |   |-- integrations/                # Concrete WordPress, browser, and preview-runtime adapters.
|   |   |   |-- browser/                 # Clipboard, Storage, DOM, and other browser adapters.
|   |   |   |-- preview-runtime/         # Preview enhancement runtime adapters.
|   |   |   `-- wordpress/               # WordPress, REST, media, and native-form adapters.
|   |   |-- shared/                      # Stable cross-feature utilities and UI primitives.
|   |   |   |-- keyboard/                # Shared keyboard and shortcut utilities.
|   |   |   `-- ui/                      # Shared UI primitives.
|   |   |-- test/                        # Frontend-only setup and fixtures.
|   |   |   `-- fixtures/                # Frontend contract fixtures.
|   |   `-- types/                       # TypeScript declarations for integration boundaries.
|   |-- test/                            # Test-only frontend inputs outside production source.
|   |   `-- build-contract/             # WordPress React/Vite build-contract fixture and verification input.
|   `-- tsconfig.json                   # Strict frontend TypeScript configuration.
|-- assets/                              # Committed styles, images, themes, vendor assets, and browser runtimes.
|   |-- build/                           # Committed manifest-backed production browser runtime bundles.
|   |-- css/                             # Admin and public content styles.
|   |   |-- admin/                       # Admin/editor styles.
|   |   `-- frontend/                    # Public content styles.
|   |-- images/                          # Local UI, support, and theme images.
|   |-- themes/                          # EasyMDE-maintained theme styles.
|   |   |-- article/                     # Article theme styles.
|   |   `-- code/                        # Code theme styles.
|   `-- vendor/                          # Locally bundled third-party runtime assets and licenses.
|       |-- fonts/                       # Bundled font files and licenses.
|       |-- highlight/                   # Bundled Highlight.js runtime and styles.
|       `-- katex/                       # Bundled KaTeX runtime, styles, and fonts.
|-- languages/                           # Translation catalogs and compiled language assets.
|-- scripts/                             # Asset, i18n, notice, test, CI, and release tooling.
|   |-- lib/                             # Shared shell safety helpers.
|   `-- vendor-licenses/                 # Tracked third-party license source material.
|-- tests/                               # PHP, Node, and browser verification suites.
|   |-- Unit/                            # Isolated PHP behavior tests.
|   |-- Integration/                     # WordPress, service, and REST integration tests.
|   |-- Node/                            # Node-based release, CI, asset, i18n, and safety tests.
|   |-- e2e/                             # Chromium Playwright author-workflow tests.
|   |-- fixtures/                        # Shared synthetic test inputs.
|   `-- phpunit/                         # PHPUnit bootstrap and test support.
|-- docs/                                # Architecture, product, development, release, and contributor documentation.
|   |-- assets/                          # Documentation-only images and assets.
|   |-- decisions/                       # Architectural decision records.
|   |-- examples/                        # Documentation examples.
|   `-- templates/                       # Canonical contribution and review templates.
|-- docker/                              # Containerized development and CI support.
|   `-- ci/                              # Reproducible CI image and WordPress test configuration.
|-- .agents/                             # Repository-scoped agent guidance.
|   `-- skills/                          # EasyMDE and internationalization execution skills.
|-- .github/                             # GitHub repository automation.
|   `-- workflows/                       # GitHub Actions workflow definitions.
|-- composer.json                        # PHP runtime and development dependency manifest.
|-- composer.lock                        # Locked PHP dependency graph.
|-- package.json                         # Node scripts and dependency manifest.
|-- package-lock.json                    # Locked Node dependency graph.
|-- biome.json                           # JavaScript and TypeScript lint configuration.
|-- phpcs.xml.dist                       # PHP coding-standard configuration.
|-- phpunit.xml.dist                     # PHPUnit configuration.
|-- playwright.config.mjs                # Playwright end-to-end configuration.
`-- docker-compose.yml                   # Local and CI service orchestration configuration.
```

The repository tree describes tracked source and committed runtime boundaries, not the contents of an installable plugin ZIP.

`assets/build/` contains committed manifest-backed production bundles and metadata, so generated filenames and hashes are intentionally omitted.

The installable ZIP adds Composer runtime `vendor/` after dependency installation and excludes `frontend/`, tests, development metadata, and repository-only documentation; source archives are separate artifacts.

Ignored dependency, cache, distribution, coverage, report, task, and machine-local paths are intentionally omitted, and `.gitignore` remains authoritative for those paths.

## Frontend Build Foundation

The root npm project owns Vite, TypeScript, Biome linting, React 18 development declarations, Vitest, CodeMirror 6, and the WordPress Element package used by browser builds. Exact `lucide-react@0.487.0` source is a development-only input to `scripts/generate-lucide-icons.mjs`; generated local icon nodes are compiled into the ordinary and immersive Editor interfaces without adding a browser runtime dependency. This version remains intentionally locked because the audited ordinary-toolbar contract uses its icon paths: `lucide-react@1.27.0` changes the visible Code, List, List Ordered, and Palette nodes. A future upgrade is therefore a visual-contract change and must repeat the controlled toolbar comparison. `npm run frontend:check` verifies the locked generated nodes, runs frontend linting, strict `tsc --noEmit`, component and contract tests, the test-only build contract, and temporary production comparisons for all eight manifest-backed Vite entries that must match their committed runtimes byte for byte.

The Vite entry under `frontend/test/build-contract/` remains test-only. It proves that React, ReactDOM, and `@wordpress/element` resolve to the WordPress-provided `wp-element` runtime, while the configured classic JSX transform emits calls to its public `createElement` API instead of assuming an unavailable automatic JSX-runtime global. It also proves that Vite and WordPress manifests agree on the generated script, dependency metadata, and plugin-relative resource paths. Its output is written to `.cache/easymde-frontend-contract/`, is not enqueued by WordPress, and is excluded from the installable plugin ZIP.

`frontend/src/entrypoints/admin-editor-loader.ts` is the PHP-enqueued production loader for the ordinary Editor. `AdminAssets` validates `assets/build/admin-editor-loader/wordpress-manifest.json` and `assets/build/wordpress-manifest.json`, enqueues the stable `easymde-admin-editor-toolbar` loader handle, and serializes the versioned loader Bootstrap with `mainScriptUrl`. The loader reads and same-origin-validates `mainScriptUrl`, dynamically loads the hashed `frontend/src/entrypoints/admin-editor.tsx` main entry, and starts the same React Editor Root after its DOM gate is ready. `templates/admin/editor-shell.php` provides one empty `#easymde-editor-root` mount and native WordPress submission fields. The Markdown field remains visible until CodeMirror owns a working document session; React then hides both that bridge field and `#postdivrich`, restoring them on teardown or failure; there is no parallel Legacy editor container.

`frontend/src/entrypoints/frontend-code-copy.ts` is a separate, non-React
production entry for published EasyMDE content. `FrontendAssets` conditionally
loads it only for regular code blocks, validates the dedicated
`assets/build/code-copy/wordpress-manifest.json` and matching asset metadata,
and enqueues the stable `easymde-code-copy` handle with no WordPress script
dependencies. The TypeScript owner adds the local Lucide Copy control, skips
Mermaid blocks, serializes Clipboard operations, restores temporary fallback
DOM, and tears down and reactivates across page lifecycle transitions. It does
not render Markdown or load the admin React application.

`frontend/src/entrypoints/frontend-enhancements.ts` is the shared non-React
production entry for syntax highlighting, KaTeX, and code-frame background
synchronization. It owns the public `EasyMDEEnhancements`,
`EasyMDEMathRenderer`, and `EasyMDEMermaidRenderer` globals while preserving
the server-rendered DOM and existing CSS contract. The separate
`frontend/src/entrypoints/frontend-bootstrap.ts` entry only waits for
`DOMContentLoaded` and invokes the shared enhancement owner. Both entries are
manifest-backed under `assets/build/frontend-enhancements/` and
`assets/build/frontend-bootstrap/`, with no WordPress script dependencies.
`frontend/src/entrypoints/frontend-mermaid-runtime.ts` imports the locked
`mermaid` npm package and publishes the narrow `window.mermaid` browser
boundary. It is built independently under `assets/build/frontend-mermaid/`
and loaded only when Markdown feature detection reports Mermaid content, so
the shared enhancement bundle does not carry the approximately 3.3 MB Mermaid
runtime on ordinary pages.

`frontend/src/entrypoints/settings-center.tsx` is the separate React entry for
the dedicated EasyMDE administration screen. `SettingsPage` requires
`manage_options`, validates the manifest-backed
`assets/build/settings-center/wordpress-manifest.json` contract, enqueues the
stable `easymde-admin-settings-center` handle only on that screen, and emits a
same-origin presentation Bootstrap contract. The Settings Center has its own
Root and does not share mutable State with the Editor Root. A setting is shown
only when a real PHP/WordPress owner and browser Adapter exist; presentation
controls never claim persistence until the authoritative Settings API result
succeeds. The comment-AI and article-sync surfaces are intentionally absent
from the current navigation and DOM.

The entrypoint parses external data before mounting, constructs focused
WordPress and browser Adapters, mounts one `EditorRoot`, and owns idempotent
teardown. The Root composes Toolbar/commands, CodeMirror document and title
sessions, server Preview and local post-response enhancements, Appearance and
Custom CSS, Fonts, Media and image upload, Local Drafts, WeChat export,
the fixed Source/Preview layout, and WordPress session state.
Components depend on typed Ports; WordPress DOM, `wp.media`, REST, Storage, and
Clipboard access remain in focused Integration Adapters.

CodeMirror owns the in-page Markdown value, Selection, Focus, Undo history, and
source scrolling. The native title and React-owned hidden Markdown fields are
synchronous submission bridges and are flushed before WordPress serializes the
open form.
React neither submits a closed field allowlist nor treats synchronization as a
successful Save, so unknown WordPress and extension fields remain intact.

The ordinary toolbar presents one compact heading dropdown containing the
registered heading-menu command surface except the Paragraph action, including
the built-in H1 through H6 commands and extension commands in registry order.
The trigger uses a compact inset H glyph, and built-in levels use outlined
H1-through-H6 badges with visibly descending type scale and weight. Every
visible command retains its configured shortcut. The site-wide shortcut
settings own 19 mappings aligned with Typora's official common shortcut table:
Save, Bold, Italic, Strikethrough,
Paragraph, H1 through H6, Quote, Unordered List, Ordered List, Inline Code,
Code Block, Math Block, Link, and Image. Settings capture real keyboard events
rather than free-form text; clearing one binding disables it and restoring
defaults resets all 19. Non-empty bindings are always shown as command hints.
Same-platform collisions with another configurable or registered command are
an invariant violation: the settings page marks every conflicting field,
blocks the request, and opens the shortcut-conflict dialog; the server and
editor runtime reject conflicts again rather than selecting a winner. The
immersive heading menu keeps its existing Paragraph-command exclusion and
presentation. The Registry keeps the native Typora defaults even when a browser
reserves a combination before page dispatch; the settings owner lets users
record a browser-deliverable replacement without creating a second default
table.

The Preview session debounces Reads, aborts superseded requests, rejects stale
revisions and Markdown signatures, and renders branded server-sanitized HTML
through one React Safe HTML sink. `easymde/v1/preview` and PHP
`MarkdownRenderer` remain the formal rendering authority. Focused TypeScript
Adapters enhance only the accepted response with local Highlight.js, KaTeX,
Mermaid, TOC, the selected Code Theme, and the Mac code frame; enhancement failure preserves
sanitized HTML and is reported without inventing a renderer fallback.

The WordPress session Adapter observes Heartbeat authentication, REST Nonce,
Post Lock, capability, and connection state through `wp.hooks`. It blocks new
protected operations at the owning boundary while preserving unsaved content,
the Dirty baseline, Local Draft recovery, and the complete native form. Save,
Publish, Media, Custom CSS, and Revision operations report only authoritative
results and never retry protected mutations automatically. The separately
approved bounded Image Hosting primary- and backup-write contract is the only
current exception; Verify Upload remains single-attempt.

Local Draft recovery uses the versioned `easymde:draft:v1:<site>:<user>:<post-or-new>` identity, a 1 MiB limit, a 500-millisecond latest-write scheduler, explicit read/write/discard failures, and cross-tab conflict handling. New-post identity comes from the stable PHP Bootstrap contract rather than WordPress's temporary auto-draft ID.

WeChat export is user-initiated compatibility output from the current stable, sanitized, locally enhanced Preview. `createWechatExportSession` owns the ordinary and immersive surfaces, and `createBrowserWechatClipboard` owns the browser Clipboard adapter and its single clone-and-serialize pipeline; the data flow is Preview sink -> session -> adapter -> browser Clipboard path. Copy never writes Markdown, `post_content`, metadata, revisions, or publication state.

`createBrowserWechatClipboard` currently limits materialized theme-image data payloads to 4,000,000 bytes, retains at most 32 background-asset cache entries, and applies 10,000 ms timeouts to approved theme-image fetch/conversion and Clipboard commit.

The executable serializer contract and edge cases are owned by the [EasyMDE WeChat export reference](../.agents/skills/easymde/references/wechat-export.md); architectural rationale and rejected alternatives are in [ADR-001](decisions/ADR-001-wechat-clipboard-serialization.md); focused verification steps are in [Testing and Release](TESTING_AND_RELEASE.md#wechat-clipboard-verification); and user-visible behavior is in the [User Guide](USER_GUIDE.md#copy-to-wechat).

## Service Wiring

`EasyMDE\Plugin` constructs and registers the plugin services. Business logic stays in focused service classes rather than in the bootstrap file or compatibility facade.

Admin HTML is prepared by PHP services and rendered by templates under `templates/admin/`. Templates should receive prepared data and avoid owning business rules.

The Settings Center is registered by `EasyMDE\\Admin\\SettingsPage` at the
canonical WordPress URL `admin.php?page=easymde&route=/general_setting`. Its
top-level WordPress menu uses the valid `easymde` page slug, labels the entry
`EasyMDE`, and uses the local `assets/images/easymde-editor-icon.png`; its first
submenu item owns the explicit General route and it exposes WordPress's native
plugin updates list at `plugins.php?plugin_status=upgrade` when the current user
can update plugins. The React Settings Center reads and writes through
`SettingsCenterRepository` and
the protected `easymde/v1/settings` route. Only General settings with an
implemented editor owner are enabled; unsupported fields stay explicitly
disabled instead of reporting a persistence success that has no runtime
consumer. The removed Settings API page and `settings.css` owner are not
registered or enqueued. `SettingsCenterRepository` accepts and writes only the
current exact settings document through its revisioned compare-and-swap path;
the shortcut contract has no historical-field import or migration path. The old
`options-general.php?page=easymde` URL remains WordPress's native General
Settings screen without EasyMDE injection, and
`admin.php?page=easymde/settings/general` is no longer an active screen. The
canonical General route is the sole Settings Center entry.

The supported General runtime settings are passed from `AdminAssets` through
the validated Editor Root bootstrap and consumed by the Editor Root's
document source, workspace layout, Preview feature overrides, focus behavior,
and local-draft session. The Settings Center auto-save switch and interval are
the only local-draft configuration for ordinary and immersive editing;
browser-session immersive preferences own presentation only. Retired
immersive auto-save values are ignored without a read-time write and disappear
on the next legitimate immersive preference change. The bootstrap marks both `post-new.php` and nonzero
`auto-draft` contexts as new documents so the auto-focus preference cannot
focus an existing post.

## Editor Mode

EasyMDE editor mode is scoped to supported post types, `post` and `page` by default. The supported post type list can be filtered with `easymde_supported_post_types`.

`PostModeController` owns the editor-admission rule for admin editing: new and existing posts for supported post types use EasyMDE when the current user can create or edit that post. The `use_block_editor_for_post` filter, editor template rendering, and admin asset loading all call that same rule.

Editor admission does not depend on `_easymde_enabled`, `_easymde_markdown`, or other EasyMDE metadata. Unsupported post types keep the normal WordPress editor unless a site explicitly adds them through `easymde_supported_post_types`.

Opening an ordinary existing supported post imports the current `post_content` into Markdown in memory for the editor. It does not write metadata, rewrite content, create revisions, or migrate the post on open.

## Data Model

Markdown is the source of truth in `_easymde_markdown`. WordPress `post_content` stores rendered HTML for themes, feeds, search, plugins, visitors, and compatibility when EasyMDE is inactive.

Important post meta keys include:

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

Legacy detection uses `metadata_exists( 'post', $post_id, '_easymde_markdown' )` so empty Markdown drafts are still recognized as EasyMDE document state. Legacy posts and ordinary supported posts are lazily marked with `_easymde_enabled = 1` during the next valid EasyMDE save.

`_easymde_render_signature` is an internal consistency marker written during
valid EasyMDE saves and successful Markdown-based revision restores. The editor
may reuse stored `post_content` for a fast initial preview only when this marker
matches the current Markdown, article theme, and stored compatibility HTML;
otherwise it renders from `_easymde_markdown`.

The Mac-style source-code frame is fixed rendering behavior, not document state. Rendered EasyMDE roots always receive `easymde-code-mac`; `code-frame.css` is loaded only when feature detection finds a regular code block. The shared stylesheet alone owns frame geometry, traffic-light dots, spacing, radius, shadow, code typography, newline preservation, and local horizontal overflow. Historical `_easymde_code_mac_style` post meta and `codeMacStyle` user-default entries are left untouched, but no active reader, writer, request, preview, or revision path consults them.

## Rendering

`EasyMDE\Content\MarkdownRenderer` is the only production Markdown renderer and requires `league/commonmark`.

Rendering behavior:

- raw Markdown HTML is stripped;
- unsafe links are disabled by the CommonMark configuration;
- math placeholders are extracted and restored as EasyMDE math nodes;
- `TocGenerator` owns heading IDs and `[TOC]` replacement;
- `ThemeMarkupTransformer` owns article-theme-specific DOM transforms and MDNice container normalization;
- final rendered HTML is passed through `wp_kses_post()`.

If Composer dependencies are missing, EasyMDE shows an admin notice, preview requests return a REST error, and save/frontend paths avoid generating fallback HTML.

## Revisions

`RevisionManager` registers EasyMDE meta keys for WordPress revisions, copies current EasyMDE meta to revisions, and restores EasyMDE meta from revisions when present.

When restoring an EasyMDE revision, the manager restores Markdown and appearance metadata. It regenerates `post_content` and stores a new render signature only when Markdown rendering succeeds. If the renderer is unavailable or cannot produce the restored content, it uses the revision's stored `post_content` without generating a new signature. Any render signature stored on that revision is restored with the other revisioned metadata and remains subject to the normal validation against the restored Markdown, article theme, and compatibility HTML. It updates `post_content` directly during restore to avoid recursive save hooks and revision loops.

When restoring a revision that predates EasyMDE document state, the manager removes the current revisioned EasyMDE metadata and restores that revision's original `post_content`. The post then no longer has EasyMDE document state; browser revision interfaces must preserve this server-owned transition rather than inventing Markdown for the historical HTML revision.

## Theme And Asset Boundaries

`ArticleThemeRegistry` and `CodeThemeRegistry` explicitly register themes. They do not scan theme directories at runtime.

Article themes are EasyMDE-owned CSS files under `assets/themes/article/`. Highlight.js vendor styles remain under `assets/vendor/highlight/styles/`. EasyMDE-owned code themes, including `wechat-inspired`, `terminal-noir`, and the distinct `fullstack-blue` token palette, are stored under `assets/themes/code/`.

Block-code presentation is independent from article-theme CSS. `assets/css/frontend/code-frame.css` owns the fixed cross-theme Mac frame. Code-theme assets own only block background, foreground, and Highlight.js token colors. Article-theme stylesheets retain inline code and non-code article presentation but contain no `pre`, Highlight.js token, frame, or legacy MDNice code-snippet selectors. Ordinary editor Preview, immersive Preview, revision Preview, REST-rendered content, and WeChat export consume the selected code-theme asset instead of defining surface-specific block-code rules. Public frontend content also consumes the selected appearance while the default-enabled `applyEditorThemeToFrontend` setting is active. When that setting is disabled, the public renderer and asset owner use one neutral default article and code-theme state without custom CSS or font overrides; stored appearance metadata and every editor Preview surface remain unchanged.

Each article-theme descriptor exposes a Registry-owned `defaultCodeTheme`. Themes with the same effective palette reuse the same registered code theme; `fullstack-blue` retains its genuinely distinct token palette without content-dependent JavaScript rewriting. When no valid persisted or browser-session code-theme choice exists, the current article association supplies the code theme. A valid explicit choice remains authoritative across later article-theme changes. `atom-one-dark` is only the compatibility fallback for a missing or invalid association, and opening the editor performs no hidden write.

The selected code theme owns block-code presentation. Because upstream Highlight.js styles apply their background to `code.hljs`, the shared highlighter copies that computed background to the outer `pre` for generic themes after highlighting. This runtime bridge does not duplicate palettes or depend on article-theme IDs, so built-in associated themes and third-party themes registered through `easymde_code_themes` remain authoritative.

The extension filters are:

```php
easymde_article_themes
easymde_code_themes
```

Frontend EasyMDE posts enqueue the selected appearance when
`applyEditorThemeToFrontend` is enabled, or the neutral default appearance when
it is disabled:

- the EasyMDE base content stylesheet;
- the selected article theme stylesheet;
- code frame CSS only when regular code blocks need it;
- the manifest-backed code-copy script and its scoped stylesheet only when
  regular code blocks support copying and the default-enabled
  `showPublishedCodeCopyButton` setting remains enabled; disabling it omits the
  control and dedicated assets while preserving the code frame, code content,
  and syntax highlighting;
- the selected code theme stylesheet and Highlight.js only when syntax highlighting is needed;
- KaTeX, the on-demand Mermaid TypeScript bundle, and TOC assets only when the
  current Markdown needs them;
- scoped custom CSS only for the current EasyMDE post when available.

Runtime rendering assets are local. The plugin does not require CDN-hosted
Mermaid, KaTeX, Highlight.js, preview, editor, or theme assets. Mermaid is a
locked build-time npm dependency compiled into its local, feature-gated
TypeScript bundle rather than copied as a standalone vendor script.

`scripts/frontend-runtime-assets.mjs` owns the current npm source, local
destination, purpose, license and notice metadata, and release requirements
for managed frontend runtime assets. `npm run prepare:assets` deliberately
refreshes those committed files; `npm run assets:check`, CI, and the release
builder only validate them and fail on drift.

## Custom CSS

Custom CSS library entries are stored in the current user's user meta with
independent `article_theme_name` and `code_theme_name` labels. Creating,
updating, and deleting full custom CSS requires `unfiltered_html`.

`CustomCssPolicy` parses CSS with `sabberworm/php-css-parser`, enforces a size limit, rejects unsafe or remote-loading constructs, and scopes selectors to EasyMDE-rendered content. It preserves valid nested `@media`, `@supports`, and keyframe rules that pass the policy.

When a post uses custom CSS, EasyMDE stores a post-level snapshot so published content can retain the selected appearance if the user later edits or removes the saved library entry.

The ordinary editor exposes Appearance and Font choices through one compact
Editor Settings popover. Its Appearance section may select an existing named
Custom CSS theme, but it does not expose Custom CSS creation or editing.
Custom CSS editing remains an immersive-editor surface, where it edits only a
browser-session draft and sends an explicit save through the existing protected
REST boundary.
React does not validate or scope CSS as a security authority, retry a mutation,
or report success before the server response has been validated. The existing
hidden Custom CSS ID and snapshot fields remain the WordPress submission
bridge. The post-level snapshot also remains usable when its library entry is
later detached.

## REST Boundaries

All EasyMDE REST routes use namespace `easymde/v1`.

Current routes:

- `POST /easymde/v1/preview`
- `POST /easymde/v1/media`
- `POST /easymde/v1/image-hosting/verification`
- `POST /easymde/v1/image-hosting/secret`
- `POST /easymde/v1/image-hosting/upload`
- `POST /easymde/v1/image-hosting/import`
- `GET /easymde/v1/theme-options`
- `POST /easymde/v1/custom-css`
- `POST /easymde/v1/custom-css/preview`
- `DELETE /easymde/v1/custom-css/{id}`
- `GET /easymde/v1/posts/{post_id}/revisions`
- `GET /easymde/v1/posts/{post_id}/revisions/{revision_id}`
- `GET /easymde/v1/settings`
- `POST /easymde/v1/settings`

Preview and theme requests with `post_id` require `current_user_can( 'edit_post', $post_id )`. Preview without a `post_id` requires `edit_posts`. Article image upload requires `upload_files`; when a `post_id` is present it also requires `current_user_can( 'edit_post', $post_id )`, and without a `post_id` it requires `edit_posts`. `/image-hosting/upload` additionally requires its action-specific Nonce. `/image-hosting/import` requires a positive `post_id`, `upload_files`, target-specific `edit_post`, the WordPress REST Nonce, and the image-upload action Nonce. Image Hosting verification and secret reveal require `manage_options`, the WordPress REST Nonce, and their own action-specific Nonces. Custom CSS endpoints access only the current user's user meta, and write/delete operations require `unfiltered_html`.

Settings reads and writes require `manage_options`; updates are sanitized and persisted with the existing editor-settings option, including the 19 toolbar shortcut mappings, the explicit `imageHostingEnabled` owner choice (default `false`), local pasted-image automatic-upload preference, and four-state remote-image paste preference. The current development defaults are a 30-second autosave interval, no automatic retry after a failed provider write, no Markdown image title, and `{year}/{month}/{md5}.{ext}` object paths. The new `remoteImageUploadMode` contract has no legacy parser, migration, compatibility alias, or schema-version branch. A POST requires the action-specific settings Nonce, a body no larger than 64 KiB, and the complete exact-key settings contract with the current nonnegative `revision`. Missing, extra, conflicting, or invalid fields are rejected, stale revisions return `easymde_settings_conflict` with HTTP 409, and an option-write failure returns `easymde_settings_persistence_failed` with HTTP 500. The option write uses a byte-exact compare-and-swap predicate so concurrent saves cannot silently clobber each other; an unchanged current submission is a successful no-op and does not increment the revision. Settings bootstrap, ordinary settings responses, transfer exports, logs, and diagnostics do not expose image-provider credentials. The optional top-level `resetSecrets: true` flag is the explicit destructive path that clears all four image-provider credentials; ordinary blank secret fields retain stored credentials. A password-field eye action is a separate explicit disclosure: `/image-hosting/secret` accepts an exact primary/backup target and Access Key/Secret Key field, returns only that saved value with `Cache-Control: no-store`, and leaves it only in current React component memory. It is never persisted, copied into browser Storage, or loaded implicitly.

Preview Markdown payloads are capped at 1 MiB. The persisted
`imageHostingEnabled` setting is the explicit owner choice for local image-file
paste and drop, and defaults to `false`. The
`autoUploadPastedImages` setting defaults to enabled and controls whether a
pasted local JPEG, PNG, GIF, or WebP is uploaded in both the ordinary source
editor and immersive editor. When automatic upload is enabled and
`imageHostingEnabled` is false, the existing protected same-origin `/media`
WordPress Media Library owner handles the local file; when it is true, the
protected same-origin `/image-hosting/upload` Image Hosting owner handles it.
Supported drop uploads use the selected owner. When automatic upload is
disabled, image paste performs no upload and inserts no Base64 replacement;
ordinary text/HTML paste and the toolbar media command remain under their
existing owners. Remote image import is forced off while Image Hosting is
disabled. This is an explicit owner selection, not a failure fallback: a
selected owner failure remains explicit and never switches to the other owner.
PHP validates the current capability, action Nonce, real MIME, extension, byte
size, configured format, and optional post authority before it reads server-only
credentials or contacts a provider.

`remoteImageUploadMode` controls only remote images discovered in the current
paste and defaults to `both`. Its exact values are `both` (visual and source),
`visual` (visual only), `source` (source only), and `off` (neither). A visual
candidate is a single pasted HTML `<img>` whose `src` is an absolute HTTP or
HTTPS URL. A source candidate is a pasted Markdown image whose destination is
an absolute HTTP or HTTPS URL. Plain URLs, non-image Markdown links, relative
and protocol-relative URLs, `data:` and `blob:` URLs, local files, existing
document content, editor opening, and Preview rendering never trigger remote
import. Local clipboard files remain governed only by
`autoUploadPastedImages`.

After authorization and settings lookup, `/image-hosting/import` returns an `unchanged` result only when the source URL has the exact same scheme and case-insensitive canonical ASCII hostname as the configured primary Viewing Image Domain.
The unchanged comparison rejects source URLs with user information, an explicit port, a query, a fragment, a trailing-dot hostname alias, or a Unicode/IDNA guess; it also rejects suffixes, subdomains, provider endpoints, CDN aliases, the backup Viewing Image Domain, and every other domain.
Path differences are allowed, and an unchanged result preserves the original URL, omits backup status, and calls neither the downloader nor the Image Hosting runtime, so it performs no primary, backup, or other storage write.
Every other eligible source continues through the normal `imported` validation, download, and image-hosting path described below.

The browser sends every eligible URL to the protected same-origin `/image-hosting/import` route and never fetches its cross-origin bytes.
For an `imported` result, the server accepts only canonical absolute HTTP/HTTPS URLs without credentials or fragments, resolves all A and AAAA addresses, rejects any address outside the explicit public CIDR policy, and uses the forced WordPress Requests cURL transport pinned to one validated address with TLS verification, redirects disabled, a ten-second timeout, streaming to a temporary file, and a response-size limit.
The imported path verifies the real GIF, JPEG, PNG, or WebP MIME and the configured size and format limits before passing the temporary file to the existing Image Hosting runtime, and every exit removes that temporary file.
Stable, redacted REST failures never expose the source URL, provider response, or credentials.
Only an authoritative result may update the current paste; cancellation, stale completion, runtime replacement, and teardown cannot alter later editor content.

The toolbar media command is a separate explicit entry point. It opens the
WordPress-native media frame and inserts the selected attachment without
changing the paste/drop upload owner. `/media` remains the protected WordPress
Media Library upload route and is the selected paste/drop owner when
`imageHostingEnabled` is false; it is not a failure fallback. `EditorMediaUploadPolicy` applies the same effective configured image
size limit to WordPress-native uploads only when the request names an editable
Post whose Post Type is supported by EasyMDE. It leaves uploads for unrelated
Posts and administration surfaces unchanged. The Editor bootstrap uses that
same effective limit for direct-upload validation and the featured-image
guidance shown in the immersive Publish dialog.

`EasyMDE\ImageHosting\ImageHostingRuntime` owns remote image preparation,
object-key construction, provider selection, and backup orchestration.
Cloudflare R2, Qiniu Kodo, Alibaba Cloud OSS, and Tencent Cloud COS are supported
symmetrically: any one may be the primary or the optional backup. Primary and
backup writes use one generated object key as a fixed runtime invariant, not a
configurable setting. R2 uses the administrator-saved, validated HTTPS S3 API
endpoint; Kodo uses
its fixed official upload and management API origins; OSS and COS derive their
official API hosts from the validated provider endpoint and bucket. OSS and COS
derive the signing region from that endpoint rather than persisting a separate
region setting. These HTTPS provider API origins are separate from the
administrator-configured Viewing Image Domain, which accepts HTTP or HTTPS and
is the public URL base used in the upload result. An HTTP image URL may be
blocked as mixed content on an HTTPS article page; that browser display
restriction does not change the provider upload result. Each provider request
uses a ten-second timeout with redirects disabled. Article primary and backup
writes may use the persisted bounded retry contract described below. Verify
Upload remains single-attempt, and no operation switches providers.

Before save, verification upload, or article upload, the settings owner and runtime both
derive a credential-free physical-destination identity. An enabled backup that
matches the primary provider coordinates and bucket is rejected with
`easymde_settings_duplicate_image_host_destination` or
`easymde_image_hosting_duplicate_destination` and HTTP 409. Matching or
different Viewing Image Domains do not disguise one physical storage target.

The runtime may resize/compress JPEG, PNG, and WebP through WordPress image
editors; GIF bytes remain unchanged to preserve animation. A successful upload
returns one authoritative URL built from the primary Viewing Image Domain and generated
object key. The single persisted `uploadRetryCount` appears in the primary
settings section, is a strict integer from `0` through `5`, defaults to `0`,
and means the maximum number of extra attempts after a destination's first
failed write. Values from `1` through `5` explicitly opt in to automatic retry
and its duplicate-request, overwrite, provider-charge, and residual-object
risks. The same configured `N` applies independently to the primary and,
when enabled, backup destination. Attempts for each destination run serially,
reuse the exact prepared bytes, object key, and provider, and stop on the first success. The
runtime proceeds to backup only after primary success. Exhausting the primary
attempts, or exhausting the backup attempts when backup is enabled, fails the
whole article upload with a stable redacted error: REST returns no image URL,
the editor inserts nothing, and its accessible error message asks the user to
retry manually. The runtime never switches providers. A provider object may
remain after overall failure because the provider contract has no reliable
cross-provider compensating delete operation. Raw provider responses,
credentials, and private endpoint details never enter REST responses or
browser bootstrap. Only a wholly successful article upload may return its
authoritative object path and public URL. Successful verification responses
may return their authoritative object path and public URL; those are not
credential-bearing provider responses.

The image-hosting verification route is the Settings Center's Verify Upload mutation; it does
not perform a metadata-only bucket probe. The protected same-origin request
carries the exact draft and settings revision, while newly entered credentials
remain inside that request. Blank draft credentials may reuse stored
credentials only when both revision and physical destination identity still
match. The runtime generates the plugin-owned EasyMDE PNG object key through
the current `fileNameRule`, the shared `ObjectKeyBuilder`, the current UTC
clock and UUID owner, and `post_id = 0`, then uploads only to the selected
target. Rules containing time or UUID variables may create a new object on
each verification. Success returns `status: uploaded`, the object path, and the
primary Viewing Image Domain URL; the accessible dialog identifies the
successful test-image upload, explains that the URL is inserted into articles,
and warns when an HTTP URL could be blocked on an HTTPS article page. Failure
is explicit, states that no article image URL was created, prompts the
administrator to check the configuration and verify again, and uses one
attempt with no provider switch. Any relevant draft edit makes the last result
stale.
Ordinary credential reads expose only configured/not-configured booleans; only
the dedicated explicit reveal route may return one saved field under the
protected, `no-store`, browser-memory-only contract above.

`ObjectKeyBuilder` defines `{md5}` as the lowercase hexadecimal MD5 digest of
the final bytes sent to the provider, after optional resize/compression. This
mirrors PicFast PicGo's `hashlib.md5(file_data).hexdigest()` content-digest
algorithm; EasyMDE derives the extension from the verified MIME type. The
default `fileNameRule` is `{year}/{month}/{md5}.{ext}`, and the default
`titleDisplay` is `none`, so generated Markdown image syntax has no title
unless the administrator explicitly changes that setting.

## Compatibility Facade

The public methods below remain available:

```php
EasyMDE_Plugin::register_toolbar_button();
EasyMDE_Plugin::register_shortcode_helper();
```

They delegate to `EasyMDE\Support\ToolbarRegistry`. Existing extension code should not need to reach into internal service classes for these compatibility APIs.

## Internationalization

EasyMDE uses the WordPress text domain `easymde` and loads bundled language files from `languages/` during plugin initialization.

PHP remains the translation owner for most browser UI text. The Editor Root reads those author-facing strings from its PHP bootstrap, and frontend enhancement scripts read visitor-facing strings from `EasyMDEFrontendConfig.strings`. Immersive word, character, reading-time, and revision counters are the first React-owned translation unit: the production `easymde-admin-editor-toolbar` script externalizes `@wordpress/i18n` to WordPress `wp.i18n`, declares the `wp-i18n` dependency, and loads its handle-based catalog through `wp_set_script_translations()`.

Translation maintenance uses:

```bash
npm run i18n:make-pot
npm run i18n:compile
npm run i18n:check
```

Third-party runtime notices are generated and checked separately with:

```bash
npm run notices:write
npm run notices:check
```
