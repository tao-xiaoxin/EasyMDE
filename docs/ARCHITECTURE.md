# EasyMDE Architecture

EasyMDE is a standalone WordPress plugin wired from `easymde.php` into `EasyMDE\Plugin`. The global `EasyMDE_Plugin` class remains as a compatibility facade for existing extension code.

This document describes the current implementation boundaries. Approved target decisions for the React, TypeScript, and Vite admin applications live in [React Design Philosophy](REACT_DESIGN_PHILOSOPHY.md); that document does not claim that target paths already exist. Development setup lives in [Development](DEVELOPMENT.md), and release validation lives in [Testing and Release](TESTING_AND_RELEASE.md).

## Directory Boundaries

- `src/Admin/`: editor screen rendering, per-post editor gating, admin settings, admin assets, and save handling.
- `src/Content/`: Markdown rendering, TOC generation, theme markup transforms, post document state, and revision restore coordination.
- `src/Theme/`: article/code theme registries, theme state, font state, custom CSS library access, and custom CSS policy.
- `src/Rest/`: `easymde/v1` REST controllers.
- `src/Frontend/`: frontend content filtering and conditional frontend asset loading.
- `src/Support/`: shared helpers, capabilities, options, lazy migration helpers, toolbar registry, and legacy facade support.
- `templates/admin/`: admin templates that render prepared data.
- `assets/themes/article/`: EasyMDE-owned article themes.
- `assets/themes/code/`: EasyMDE-owned code themes.
- `assets/vendor/`: committed third-party runtime assets prepared from locked npm packages or verified upstream repository sources.
- `frontend/`: strict TypeScript, React, CodeMirror, and Vite source for the production normal-editor Toolbar, document session, Preview Surface, synchronized scrolling, Font controls, Appearance controls, Media-picker session, pasted/dropped image upload session, Local Draft session, and WeChat export, plus the test-only WordPress React build-contract fixture.
- `scripts/`: local asset preparation, i18n/notices, test setup, Plugin Check, clean WordPress install, and release package assembly scripts.
- `tests/Unit/` and `tests/Integration/`: PHPUnit coverage for rendering, CSS policy, frontend assets, REST permissions, revisions, migration, editor gating, and compatibility facade behavior.
- `tests/Node/`: Node tests for release packaging, CI invariants, i18n/notices, Plugin Check parsing, and destructive-script safety.
- `tests/e2e/`: Chromium Playwright coverage for installed release ZIP author workflows.

## Frontend Build Foundation

The root npm project owns Vite, TypeScript, Biome linting, React 18 development declarations, Vitest, CodeMirror 6, and the WordPress Element package used by browser builds. `npm run frontend:check` runs frontend linting, strict `tsc --noEmit`, component and contract tests, the test-only build contract, and a temporary production Editor build that must match the committed runtime byte for byte.

The Vite entry under `frontend/test/build-contract/` remains test-only. It proves that React, ReactDOM, and `@wordpress/element` resolve to the WordPress-provided `wp-element` runtime, while the configured classic JSX transform emits calls to its public `createElement` API instead of assuming an unavailable automatic JSX-runtime global. It also proves that Vite and WordPress manifests agree on the generated script, dependency metadata, and plugin-relative resource paths. Its output is written to `.cache/easymde-frontend-contract/`, is not enqueued by WordPress, and is excluded from the installable plugin ZIP.

`frontend/src/entrypoints/admin-editor.tsx` is the production React Editor entry. It exposes focused Toolbar, document-source, normal Preview Surface, synchronized-scroll, Font-controls, Appearance-controls, Media-picker, image-upload, Local Draft, and WeChat-export bridges from one WordPress-loaded script. The Toolbar bridge mounts the normal editor's main Markdown Toolbar into a PHP-delegated container and renders `features/toolbar/ui/EditorToolbar.tsx`. PHP `ToolbarRegistry` descriptors, translated labels, and shortcut configuration remain the bootstrap authority. After readiness, `features/toolbar/toolbar-command-session.ts` owns normal-editor Markdown command rules and transactions through a focused document Port; image commands delegate to the Media-picker owner. A focused browser Adapter then owns the normal Editor command-shortcut listener and delegates non-document commands to their established owners. Bootstrap removes the Legacy command listener before activating React, restores exactly one Legacy listener if activation fails before use, and reports reload-required if Legacy cleanup itself fails. Legacy Popover dismissal remains independently active for normal-editor fallback surfaces. `assets/js/admin/commands.js` remains required for normal-editor startup fallback, the secondary Toolbar, compatibility consumers, and the intentionally excluded immersive Toolbar and shortcuts. The remaining secondary Toolbar presentation, including the Local Draft status, WeChat button, and immersive-workspace entry, remains outside the React Roots.

The document-source bridge mounts CodeMirror 6 into a dedicated source container. CodeMirror owns the normal editor's browser-session Markdown value, selection, focus, undo history, and source scrolling after readiness. The hidden native `#easymde-source` textarea remains the synchronous WordPress submission bridge and pre-handoff command fallback; every accepted CodeMirror transaction updates it immediately. The Toolbar command Port switches dynamically to the React document session when that owner is active, so post-handoff commands do not create a competing textarea writer. The native WordPress title input remains both the title session adapter and submission field. PHP and WordPress remain authoritative for persistence, rendering, saving, publishing, revisions, permissions, and native form serialization.

The Preview Surface bridge owns normal-editor Preview scheduling, visible state, DOM output, and scroll preservation after readiness. It preserves the 180 millisecond debounce, aborts superseded browser requests, assigns request revisions, and publishes only the latest response whose revision and Markdown signature still match the active session. Its WordPress Adapter calls the existing protected `easymde/v1` Preview Route with the current bootstrap Nonce; PHP remains the rendering, permission, sanitization, and response authority. The React article is the single normal-editor sink for branded server-sanitized Preview HTML. PHP-translated Bootstrap strings remain the Loading, Empty, and Error message authority.

The existing `assets/js/admin/preview-feature-loader.js` and local Mermaid, KaTeX, Highlight.js, TOC, and code-frame runtimes remain a focused post-response enhancement Adapter. React rejects stale enhancement completion before it can mark newer HTML ready, and enhancement failure preserves the sanitized HTML while withholding export readiness. Startup failure before handoff leaves the legacy Preview usable. After handoff, teardown or failure marks Preview ownership as reload-required rather than switching live DOM writers. Immersive Preview remains fully legacy-owned with an independent request revision, timer, abort, DOM, and enhancement lifecycle.

The synchronized-scroll bridge owns only the normal editor's bidirectional Source/Preview scroll coordination. Its browser Adapter validates both active surfaces before activation, maps their scrollable ratios in either direction, prevents re-entrant scroll events with a 30 millisecond lock, and removes both listeners and any pending timer during rebinding or teardown. Bootstrap performs read-only entry validation while the Legacy binding remains available. The first successful binding commits React ownership; a pre-handoff failure keeps the Legacy normal-editor binding, while a later rebinding failure is reload-required and never installs a second Legacy listener. Source and Preview replacement reuse this same owner. Focus Mode keeps its independent Legacy workspace scrolling, view-mode, divider, and preference behavior.

The Font-controls bridge validates the four PHP-provided Custom, Windows, Apple, and Serif option groups and mounts beside the legacy Font menu. React owns the normal editor's Font button, Popover, selects, and browser-session selection after readiness. Its focused Port applies the existing Preview font class and CSS variable and synchronizes the four existing hidden fields as a native submission bridge. PHP `ThemeStateRepository` remains authoritative for option descriptors, defaults, validation, and persisted state; `AdminAssets::get_strings()` remains the translation owner. Theme defaults and explicit immersive Font changes replace the active React Font session state through the focused bridge so returning to the normal editor cannot expose or reapply a stale selection. Startup failure keeps the legacy Font menu active, while failure after handoff requires reload and never enables a second writer. Every immersive Font surface remains legacy-owned.

The Appearance-controls bridge validates the PHP-provided Article Theme, Code Theme, Custom CSS library, current selection, and translated strings before mounting beside the legacy Appearance control. React owns the normal editor's Appearance button, Dialog, browser-session Article and Code Theme selection, Custom CSS editor state, and explicit Custom CSS save coordination after readiness. Its focused Port applies the existing Preview classes and scoped CSS, synchronizes the existing native theme and Custom CSS fields, and calls the protected Custom CSS REST owner. PHP theme registries, `ThemeStateRepository`, `CustomCssPolicy`, REST authorization, current-user library scope, native form serialization, and persistence remain authoritative. Custom CSS save is single-flight and validates the complete response before replacing browser state. Explicit immersive appearance changes replace the active React snapshot so returning to the normal editor cannot expose stale state. Startup failure keeps the legacy Appearance control active; failure after handoff marks ownership reload-required and never re-enables a competing writer. Every immersive Appearance surface remains legacy-owned.

The Media-picker bridge owns the normal editor's WordPress Media Library opening, single active frame operation, selected-attachment validation, Markdown insertion, and Selection, Scroll, and Focus restoration. It receives the active normal document owner through a narrow Port and delegates native selection to `wp.media`; WordPress remains the Media Library, attachment, capability, and modal authority. A selected attachment is applied only when the captured Markdown snapshot is still current, so an asynchronous stale result cannot overwrite newer text. If the WordPress media API is unavailable, the established Markdown image placeholder remains the explicit local fallback. The retained `assets/js/admin/media-picker.js` owner remains active for the intentionally excluded immersive workspace and as the normal-editor startup fallback when the production entry is unavailable.

The image-upload bridge owns normal-editor image Paste/Drop recognition, parallel operation isolation, progress and failure status, response validation, Markdown insertion, and Selection, Scroll, Focus, and teardown behavior. The WordPress Adapter sends the captured `File`, Post ID, generated alt text, and current REST nonce through the existing protected `easymde/v1/media` route. PHP and WordPress remain authoritative for capabilities, nonce validation, file type and size validation, Media Library persistence, attachment identity, and the returned URL. A failed or oversized upload never changes Markdown. A successful operation rebases its captured insertion point against current session text; completion after teardown is diagnosed without mutating a later owner. The retained `assets/js/admin/image-paste.js` owner remains active for the intentionally excluded immersive workspace and as the normal-editor startup fallback when the production entry cannot activate.

The Local Draft bridge owns normal-editor recovery reads, bounded versioned writes, restore/discard intent, the 500 millisecond latest-write scheduler, and cross-tab conflict coordination after readiness. Recovery payloads use `easymde:draft:v1:<site>:<user>:<post-or-new>`, are limited to 1 MiB, and contain only Markdown, its fingerprint, schema version, and update time. PHP Bootstrap supplies the scoped identity, WordPress user locale, site timezone, limits, and translated messages; browser storage remains the recovery authority and is never treated as a WordPress Save. The retained Focus Mode document owner supplies its current bridged Markdown to this scheduler without becoming a second Storage writer. A read failure or different cross-tab candidate cancels and blocks writes until storage can be read safely or the user resolves the candidate. Startup failure keeps the Legacy writer active. Once handoff commits, teardown marks the capability reload-required and never reactivates the Legacy writer in the same page.

`assets/js/admin/draft-storage.js` remains available as the pre-handoff normal-editor fallback and as the compatibility owner used by the intentionally retained immersive workspace. It can read and discard the versioned recovery key so a later React startup failure does not strand recovery data, but it never writes that key. If both keys coexist after a fallback write, the Legacy and React readers select the newest valid payload by timestamp. A successful React write removes the old unversioned key only after the new recovery payload and fingerprint sidecar are stored; partial cleanup remains observable through stable privacy-safe diagnostic codes.

The WeChat-export bridge owns only the normal editor's stable-Preview export operation. It resolves the current active Preview Surface at command time, rejects Loading, Empty, failed, stale, or enhancement-pending surfaces, clones the server-sanitized Preview, inlines the established computed presentation, and removes non-export nodes and private DOM identifiers before writing HTML and plain text. The Clipboard mutation is single-flight. Success is announced only after the Clipboard API or the synchronous compatibility copy succeeds; failure and completion after teardown remain observable through stable privacy-safe codes. The secondary Toolbar button and translated labels remain established presentation contracts. `assets/js/admin/wechat-exporter.js` is retained for normal-editor startup fallback and the intentionally excluded immersive workspace, whose copy feedback and interaction Owner does not move.

`AdminAssets` reads `assets/build/wordpress-manifest.json` and the matching dependency metadata before enqueueing the stable `easymde-admin-editor-toolbar` handle ahead of `easymde-admin`. Legacy Toolbar, command-shortcut, source, Preview, synchronized-scroll, Font, Appearance, Media-picker, image-upload, Local Draft, and WeChat-export owners remain available during their respective React preparation and activation. Only validated readiness switches each explicit owner. A missing, invalid, or failed production entry before handoff leaves the corresponding legacy owner usable and reports a stable privacy-safe diagnostic. Document teardown flushes the submission bridge before unmounting; a Preview, synchronized-scroll, Font, Appearance, Local Draft, or WeChat-export failure after its handoff requires a clean page reload and never reactivates the hidden legacy owner in the same session.

## Service Wiring

`EasyMDE\Plugin` constructs and registers the plugin services. Business logic stays in focused service classes rather than in the bootstrap file or compatibility facade.

Admin HTML is prepared by PHP services and rendered by templates under `templates/admin/`. Templates should receive prepared data and avoid owning business rules.

## Editor Mode

EasyMDE editor mode is scoped to supported post types, `post` and `page` by default. The supported post type list can be filtered with `easymde_supported_post_types`.

`PostModeController` owns the editor-admission rule for admin editing: new and existing posts for supported post types use EasyMDE when the current user can create or edit that post. The `use_block_editor_for_post` filter, editor template rendering, and admin asset loading all call that same rule.

Editor admission does not depend on `_easymde_enabled`, `_easymde_markdown`, or other EasyMDE metadata. Unsupported post types keep the normal WordPress editor unless a site explicitly adds them through `easymde_supported_post_types`.

Opening an ordinary existing supported post imports the current `post_content` into Markdown in memory for the editor. It does not write metadata, rewrite content, create revisions, or migrate the post on open.

## Immersive Workspace Boundary

The normal WordPress edit screen and the immersive workspace are separate visual surfaces. The normal editor keeps its existing template and styles. Selecting **Enter immersive writing** creates the fixed white workspace from `assets/js/admin/immersive-workspace.js` and `assets/css/admin/immersive-workspace.css`; closing it removes that DOM and restores focus, scroll, and WordPress interactivity.

The workspace owns presentation and transient UI state only. It synchronizes with the existing WordPress title field, EasyMDE Markdown source, preview renderer, theme/font fields, local draft service, media frame, revision REST API, and native save/publish form. Opening or cancelling its publish dialog writes nothing. Confirming maps the dialog draft back to the existing WordPress fields and triggers the native publish action so nonce, capability, taxonomy, visibility, scheduling, autosave, revision, and media behavior remain WordPress-owned.

The workspace may persist only layout preferences in browser storage: the source/preview split ratio and outline width. Its AI panel is a local interface demonstration and must not read article content, make network requests, or persist AI input or output.

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

The Mac-style source-code frame is fixed rendering behavior, not document state. Rendered EasyMDE roots always receive `easymde-code-mac`; `code-frame.css` is loaded only when feature detection finds a regular code block. Historical `_easymde_code_mac_style` post meta and `codeMacStyle` user-default entries are left untouched, but no active reader, writer, request, preview, or revision path consults them.

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

Article themes are EasyMDE-owned CSS files under `assets/themes/article/`. Highlight.js vendor styles remain under `assets/vendor/highlight/styles/`. The EasyMDE-owned `wechat-inspired` code theme is stored under `assets/themes/code/`.

The extension filters are:

```php
easymde_article_themes
easymde_code_themes
```

Frontend EasyMDE posts enqueue:

- the EasyMDE base content stylesheet;
- the selected article theme stylesheet;
- code frame CSS only when regular code blocks need it;
- the selected code theme stylesheet and Highlight.js only when syntax highlighting is needed;
- KaTeX, Mermaid, and TOC assets only when the current Markdown needs them;
- scoped custom CSS only for the current EasyMDE post when available.

Runtime rendering assets are local. The plugin does not require CDN-hosted Mermaid, KaTeX, Highlight.js, preview, editor, or theme assets.

`scripts/frontend-runtime-assets.mjs` owns the current npm source, local
destination, purpose, license and notice metadata, and release requirements
for managed frontend runtime assets. `npm run prepare:assets` deliberately
refreshes those committed files; `npm run assets:check`, CI, and the release
builder only validate them and fail on drift.

## Custom CSS

Custom CSS library entries are stored in the current user's user meta. Creating, updating, and deleting full custom CSS requires `unfiltered_html`.

`CustomCssPolicy` parses CSS with `sabberworm/php-css-parser`, enforces a size limit, rejects unsafe or remote-loading constructs, and scopes selectors to EasyMDE-rendered content. It preserves valid nested `@media`, `@supports`, and keyframe rules that pass the policy.

When a post uses custom CSS, EasyMDE stores a post-level snapshot so published content can retain the selected appearance if the user later edits or removes the saved library entry.

The normal-editor React Appearance owner edits only a browser-session draft and sends an explicit save through the existing protected REST boundary. It does not validate or scope CSS as a security authority, retry a mutation, or report success before the server response has been validated. The existing hidden Custom CSS ID and snapshot fields remain the WordPress submission bridge. The post-level snapshot also remains usable when its library entry is later detached, while the retained immersive Appearance owner continues to use the same PHP and REST authorities.

## REST Boundaries

All EasyMDE REST routes use namespace `easymde/v1`.

Current routes:

- `POST /easymde/v1/preview`
- `POST /easymde/v1/media`
- `GET /easymde/v1/theme-options`
- `POST /easymde/v1/custom-css`
- `POST /easymde/v1/custom-css/preview`
- `DELETE /easymde/v1/custom-css/{id}`
- `GET /easymde/v1/posts/{post_id}/revisions`
- `GET /easymde/v1/posts/{post_id}/revisions/{revision_id}`

Preview and theme requests with `post_id` require `current_user_can( 'edit_post', $post_id )`. Preview without a `post_id` requires `edit_posts`. Pasted-image media uploads require `upload_files`; when a `post_id` is present they also require `current_user_can( 'edit_post', $post_id )`, and without a `post_id` they require `edit_posts`. Custom CSS endpoints access only the current user's user meta, and write/delete operations require `unfiltered_html`.

Immersive category options use a short-lived object-cache entry scoped by site, user, capabilities, locale, post type, post ID, and the WordPress term `last_changed` value. Extensions whose term-query filters depend on additional request state can extend `easymde_category_options_cache_context`, or return `false` from that filter to bypass this cache without bypassing WordPress's native term filters.

Preview Markdown payloads are capped at 1 MiB. EasyMDE media uploads accept local JPEG, PNG, GIF, and WebP image files only; remote image-provider uploads are not part of the REST surface.

## Compatibility Facade

The public methods below remain available:

```php
EasyMDE_Plugin::register_toolbar_button();
EasyMDE_Plugin::register_shortcode_helper();
```

They delegate to `EasyMDE\Support\ToolbarRegistry`. Existing extension code should not need to reach into internal service classes for these compatibility APIs.

## Internationalization

EasyMDE uses the WordPress text domain `easymde` and loads bundled language files from `languages/` during plugin initialization.

PHP remains the translation source for browser UI text. Admin JavaScript reads author-facing strings from `EasyMDEConfig.strings`, and frontend enhancement scripts read visitor-facing strings from `EasyMDEFrontendConfig.strings`.

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
