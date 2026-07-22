# EasyMDE Architecture

EasyMDE is a standalone WordPress plugin wired from `easymde.php` into `EasyMDE\Plugin`. The global `EasyMDE_Plugin` class remains as a compatibility facade for existing extension code.

This document describes the current implementation boundaries. Approved target decisions for the React, TypeScript, and Vite admin applications live in [React Design Philosophy](REACT_DESIGN_PHILOSOPHY.md); that document does not claim that target paths already exist. Development setup lives in [Development](DEVELOPMENT.md), and release validation lives in [Testing and Release](TESTING_AND_RELEASE.md).

## Issue #91 Direct React Cutover

The maintainer-approved target for the ordinary WordPress Editor is one Vite
production entry mounting one React 18 Editor Root. This is a direct cutover,
not another sequence of Legacy-to-React runtime handoffs. The final ordinary
Editor does not enqueue or execute `assets/js/admin/bootstrap.js`, jQuery, the
Legacy Toolbar, Preview, Theme, Draft, Media runtimes, Legacy fallback DOM, or
Focus Mode / immersive-writing assets.

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
Focus Mode is not part of the default ordinary-editor surface. Issue #126
provides a same-root immersive presentation that reuses the ordinary
CodeMirror, Preview, native form, and WordPress capability owners. Outline,
statistics/status, and view switching are scoped to that presentation;
Publish and Revision controls delegate to the existing WordPress owners.

The ordinary Editor now follows this single-Root boundary in the live branch.
Legacy admin Browser Runtime files and Focus Mode assets have no ordinary
Editor consumer and are excluded from the release package. Historical data and
public PHP compatibility contracts remain preserved as described below.

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

`frontend/src/entrypoints/admin-editor.tsx` is the sole production browser
entry for the ordinary Editor. `AdminAssets` validates
`assets/build/wordpress-manifest.json` and its dependency metadata, enqueues the
stable `easymde-admin-editor-toolbar` handle, serializes the versioned Root
Bootstrap contract, and does not enqueue an admin Legacy bootstrap, jQuery, or
Focus Mode assets. `templates/admin/editor-shell.php` provides one empty
`#easymde-editor-root` mount and native WordPress submission fields. The
Markdown field remains visible until CodeMirror owns a working document session;
React then hides both that bridge field and `#postdivrich`, restoring them on
teardown or failure; there is no parallel Legacy editor container.

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

The Preview session debounces Reads, aborts superseded requests, rejects stale
revisions and Markdown signatures, and renders branded server-sanitized HTML
through one React Safe HTML sink. `easymde/v1/preview` and PHP
`MarkdownRenderer` remain the formal rendering authority. Focused TypeScript
Adapters enhance only the accepted response with local Highlight.js, KaTeX,
Mermaid, TOC, Code Theme, and the fixed Mac frame; enhancement failure preserves
sanitized HTML and is reported without inventing a renderer fallback.

The WordPress session Adapter observes Heartbeat authentication, REST Nonce,
Post Lock, capability, and connection state through `wp.hooks`. It blocks new
protected operations at the owning boundary while preserving unsaved content,
the Dirty baseline, Local Draft recovery, and the complete native form. Save,
Publish, Media, Custom CSS, and Revision operations report only authoritative
results and never retry protected mutations automatically.

Local Draft recovery uses the versioned
`easymde:draft:v1:<site>:<user>:<post-or-new>` identity, a 1 MiB limit, a
500-millisecond latest-write scheduler, explicit read/write/discard failures,
and cross-tab conflict handling. New-post identity comes from the stable PHP
Bootstrap contract rather than WordPress's temporary auto-draft ID. WeChat
export accepts only the current stable sanitized and enhanced Preview; Clipboard
failure remains visible and temporary fallback DOM, Selection, Focus, and Scroll
are cleaned up.

## Service Wiring

`EasyMDE\Plugin` constructs and registers the plugin services. Business logic stays in focused service classes rather than in the bootstrap file or compatibility facade.

Admin HTML is prepared by PHP services and rendered by templates under `templates/admin/`. Templates should receive prepared data and avoid owning business rules.

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

The normal-editor React Appearance owner edits only a browser-session draft and sends an explicit save through the existing protected REST boundary. It does not validate or scope CSS as a security authority, retry a mutation, or report success before the server response has been validated. The existing hidden Custom CSS ID and snapshot fields remain the WordPress submission bridge. The post-level snapshot also remains usable when its library entry is later detached.

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
