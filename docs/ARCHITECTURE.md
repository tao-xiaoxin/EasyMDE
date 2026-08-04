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
CodeMirror, Preview, native form, and WordPress capability owners. The ordinary
workspace has one restrained footer for the live Markdown character count and
WordPress-owned last-editor timestamp. Immersive Outline, expanded writing
statistics, and view switching remain scoped to the immersive presentation;
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
- `assets/vendor/`: committed third-party runtime assets prepared from locked npm packages or verified upstream repository sources; compiled TypeScript bundles have their own manifest-backed `assets/build/` roots.
- `frontend/`: strict TypeScript, React, CodeMirror, and Vite source for the production normal-editor Toolbar, document session, Preview Surface, synchronized scrolling, Font controls, Appearance controls, Media-picker session, pasted/dropped image upload session, Local Draft session, WeChat export, public code-copy enhancement, shared public code/math enhancement runtime, and the on-demand Mermaid package runtime, plus the test-only WordPress React build-contract fixture.
- `scripts/`: local asset preparation, i18n/notices, test setup, Plugin Check, clean WordPress install, and release package assembly scripts.
- `tests/Unit/` and `tests/Integration/`: PHPUnit coverage for rendering, CSS policy, frontend assets, REST permissions, revisions, migration, editor gating, and compatibility facade behavior.
- `tests/Node/`: Node tests for release packaging, CI invariants, i18n/notices, Plugin Check parsing, and destructive-script safety.
- `tests/e2e/`: Chromium Playwright coverage for installed release ZIP author workflows.

## Frontend Build Foundation

The root npm project owns Vite, TypeScript, Biome linting, React 18 development declarations, Vitest, CodeMirror 6, and the WordPress Element package used by browser builds. Exact `lucide-react@0.487.0` source is a development-only input to `scripts/generate-lucide-icons.mjs`; generated local icon nodes are compiled into the ordinary and immersive Editor interfaces without adding a browser runtime dependency. This version remains intentionally locked because the audited ordinary-toolbar contract uses its icon paths: `lucide-react@1.27.0` changes the visible Code, List, List Ordered, and Palette nodes. A future upgrade is therefore a visual-contract change and must repeat the controlled toolbar comparison. `npm run frontend:check` verifies the locked generated nodes, runs frontend linting, strict `tsc --noEmit`, component and contract tests, the test-only build contract, and temporary production Editor, public code-copy, shared enhancement, and DOM bootstrap builds that must match their committed runtimes byte for byte.

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
visible command retains its configured shortcut. The immersive heading menu keeps its
existing Paragraph-command exclusion and presentation.

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
results and never retry protected mutations automatically.

Local Draft recovery uses the versioned
`easymde:draft:v1:<site>:<user>:<post-or-new>` identity, a 1 MiB limit, a
500-millisecond latest-write scheduler, explicit read/write/discard failures,
and cross-tab conflict handling. New-post identity comes from the stable PHP
Bootstrap contract rather than WordPress's temporary auto-draft ID. WeChat
export is invoked with only the current stable sanitized and enhanced Preview.
The session/EditorRoot owns that source boundary; the Adapter serializes the
HTMLElement it receives and does not establish a second document authority. The
`createBrowserWechatClipboard` Adapter owns one clone-and-serialize pipeline;
that session passes it the current stable Preview sink. Both
`navigator.clipboard.write` and the legacy `document.execCommand('copy')`
compatibility path receive the same normalized HTML. The modern path derives
`text/plain` from the connected normalized export surface captured for that
same preparation after removing exporter whitespace markers and normalizing
non-breaking spaces; the modern plain-text measurement host uses the rendered
Preview width, reusing the last non-zero rendered width while immersive source
mode temporarily hides the Preview surface. The legacy path selects the same
HTML and lets the destination derive visible plain text. When WeChat export is
disabled by bootstrap, EditorRoot does not schedule background preparation or
fetch theme assets. Stable Preview notifications schedule
one debounced preparation after the Preview settles; this may prewarm the
Adapter's bounded same-origin theme-image cache (at most 32 entries). Each
approved same-origin theme-image request has a ten-second abortable timeout
that remains active through fetch, response-body reads, and Data URL
conversion; timeout evicts the pending cache entry and fails the preparation
so a later copy may retry it. The browser adapter forwards the serializer-owned
RequestInit signal unchanged. When
approved theme-image preparation is still pending, the modern path passes
deferred `Blob` Promises to one `ClipboardItem` and starts
`navigator.clipboard.write` in the originating click task. When no approved
theme image needs asynchronous materialization, the modern path still uses
the asynchronous prepared payload; background preparation never performs a
synchronous full-Preview serialization. If `ClipboardItem` construction or
the `write()` invocation throws synchronously and no current prepared payload
exists, the adapter may make one synchronous serialization attempt in that
originating click task for the activation-safe legacy fallback. Preparation
retains one serialized HTML/plain-text payload for the current Preview sink; the legacy path
consumes it only when ready and calls `execCommand` synchronously in that same
click task. A click before required asynchronous preparation completes, a modern
write rejected after an await, or a payload that resolves after a fast write with
an error is an explicit failure and never enters legacy asynchronously. A
synchronous `ClipboardItem`/`write()` setup failure may use the current prepared
payload through legacy in the same click task. Immersive visual edits coalesce
  preparation, and later stable Preview notifications replace the prepared
  payload; the full sink markup, including root `class`/`style` attributes,
  plus the current viewport, computed export styles, pseudo-element styles, and
  element geometry is checked before reuse. Window/viewport resize and
  immersive split-pane changes schedule a refreshed payload, so layout-only
  changes cannot strand a stale legacy copy: while a replacement is pending,
  the last resolved payload remains available to the synchronous legacy path
  only when the source markup is unchanged; a successful replacement
  supersedes it, a failed replacement restores the newest successful
  same-source payload (including one resolved by an older overlapping refresh),
  and changed source markup never reuses it. Preparation generations are
  monotonic, so an older completion cannot downgrade a newer successful
  same-source fallback. The layout fingerprint ignores viewport-relative
  `left`/`top`/`right`/`bottom` coordinates so ordinary page scrolling does not
  invalidate a payload; dimensions and computed styles that affect wrapping still
  invalidate it. Background preparation failures remain quiet until the
  actual copy attempt reports the failure. When the legacy path has no prepared
  entry after a transient failure, that click starts one background retry but
  still returns failure; a later click may use it only after it resolves. The browser
  environment also observes the current sink's image/video load, error,
  metadata, and resize events, FontFaceSet loading completion/failure,
  ResizeObserver geometry, and inserted or removed descendants; those
  post-render layout changes schedule the same refresh, removed nodes are
  unobserved immediately, and observers/listeners are cleaned up with the sink.
  Font, theme,
  or responsive layout changes cannot reuse stale HTML, and output from the
  moment immersive mode opened or from an earlier edit is not reused.
  The EditorRoot observes whichever Preview surface is currently active,
  including the immersive visual surface. When a visual appearance or Custom CSS
  update first tears down that runtime, the refreshed ordinary Preview snapshot
  triggers preparation after cleanup, so legacy Copy never depends on a stale or
  disposed element.
  Stable Preview snapshot notifications target that same active surface; a
  hidden ordinary Preview refresh cannot cancel preparation for the editable
  visual surface.
  EditorRoot marks these notifications as background preparation: the adapter
  starts at most one full Preview serialization per sink, keeps only the latest
  request while that serialization is active, and waits for a quiet turn before
  replacing it. Background style and geometry walks also yield to browser tasks
  periodically, so rapid immersive split-layout changes remain interactive
  without weakening the full markup, viewport, style, pseudo-element, and
  geometry freshness checks used by Copy.
Copy is a browser compatibility output and never writes Markdown,
`post_content`, metadata, revisions, or publication state.

Mermaid flowcharts use SVG `foreignObject` labels whose preview dimensions are
calculated with the preview font. WeChat can use a wider fallback font and
also strips `white-space`, `word-break`, and `<nobr>` during paste. The shared
serializer therefore scopes visible overflow and non-wrapping structure to
Mermaid `foreignObject` labels, expands numeric label widths around the original
center by at least 32px or 1.5x, and gives the XHTML label container intrinsic
`max-content` sizing. It also inserts zero-width word-joiner markers; modern
plain text removes those markers. This keeps the full label when the destination
font is wider without moving the node's center. Ordinary SVG, ER/text
diagrams, and KaTeX are not rewritten by this Mermaid-specific path.

The serializer removes scripts, styles, interactive controls, CSS classes, and
source/editor transient attributes; keeps only valid fragment IDs and
SVG-internal IDs; sanitizes URL and style values; preserves safe image `src`,
`srcset` candidates, and link URLs; remote `<img>`/`srcset` candidates may
remain but are not fetched by the serializer; removes unsafe URLs and replaces
remote/non-allowlisted CSS background URLs with `none` layer slots; and
materializes only same-origin `/assets/images/`
GIF/JPEG/PNG/WebP background assets as bounded data images (at most 32 cached
assets; each fetched source blob is limited by `MAX_DATA_IMAGE_LENGTH` =
4,000,000). Repeating theme
backgrounds retain their materialized `background` declaration rather than
being flattened to one `<img>`. Generated theme-image
`<img>` nodes retain their explicit background dimensions and are excluded from
generic media bounds. A single numeric `background-size` token maps to an
explicit width with `height:auto`; a second numeric token remains the
explicit height. Omitted or `auto` sizing remains intrinsic rather than being
stretched to the host box, while `cover` and `contain` map to equivalent
`object-fit` sizing. CSS edge-offset positions such as `right 12px bottom 6px`
retain both edge and offset values. Materialized theme images use `max-width:none` so a fixed
decoration wider than its host is not clamped by destination image defaults.
For non-repeating multi-layer
backgrounds, non-image layers such as gradients remain in the copied CSS and
each safe image layer becomes an isolated overlay with its original order,
background size, and background position. The copied `background-repeat`,
`background-position`, and `background-size` longhands are expanded according
to CSS's repeated-final-layer semantics and compacted by the removed image
indexes, so they remain aligned with retained layers. Quoted pseudo-elements
with visible text use an isolated negative-level image overlay; empty
decoration pseudo-elements may retain an in-flow image footprint. It preserves
approved computed typography, borders, quoted-literal pseudo elements, theme
  decorations, non-root decoration dimensions/relative/absolute positioning/
  flex sizing/float/overflow and box sizing, non-math SVG responsiveness, media bounds without
  changing inline media display or margins, and KaTeX's visual SVG tree, but
  removes only the `.katex-mathml` tree so WeChat cannot import two competing
  formula trees. Hidden SVG `<defs>` subtrees are retained for visible
  clip-path/mask/gradient/filter references, while unrelated hidden nodes are
  removed. Non-literal pseudo content such as `attr()` and counters is
  intentionally omitted. KaTeX MathML in this contract means only the generated
  `.katex-mathml` fallback tree; arbitrary MathML authored in Markdown is not
  implicitly normalized. Materialized background-image overlays use an
  isolated negative stacking level so they remain behind copied text. Computed
  `0%`, `50%`, and `100%` background positions are normalized before composing
  centered theme-image overlays. Single-token `background-position` values use
  CSS's centered missing-axis default. Two-value keyword/offset positions follow
  CSS axis order (`left 10px` uses the vertical offset and `top 10px` uses the
  horizontal offset); explicit edge offsets use the four-value form. Fixed/sticky positioning is never reactivated
  by a generated overlay, and offsets inert under static positioning are
  neutralized when the exporter creates a relative containing block.
  Exporter-owned `aria-hidden` decoration
and `leaf` markers are structural exceptions to source transient-attribute
removal. Article/div roots become portable sections and text leaves are wrapped
for destination stability. Code frames encode line breaks explicitly and keep
each source line non-wrapping.
Tables and display formulas are centered within the destination column and
receive horizontal-overflow rules; inline formulas remain non-wrapping. Each
copied table is placed in a real block scroll owner while the table keeps
intrinsic `max-content` sizing, so short tables remain centered and wide rows
scroll horizontally without relying on ignored overflow on `display:table`.
When full-width behavior is derived from rendered geometry rather than a
literal `width:100%`, the serializer caches the source table's last visible
classification and reuses it while immersive source mode hides the Preview;
a later visible pass replaces that classification.
Theme table shims (`display:contents`, `container-type`, and `100cqi`
pseudo-element geometry) are preserved. Task-list checkboxes retain checked
state as disabled, attribute-minimized controls; arbitrary form controls are
removed. The actual code/table/formula scroll owner must be checked in the
destination, and no exporter wrapper may impose a whole-article height or
vertical scrollbar, so a page-level WeChat scrollbar is not evidence of an
article-level serializer defect.

On failure, the Adapter reports the actual browser result. Its temporary
fallback container, Selection, Focus, and Scroll are restored on every exit;
the WeChat export session exposes an error and never claims a copy succeeded.
`createWechatExportSession` is the single session owner shared by the ordinary
and immersive surfaces. It checks the enabled/active state and the current
Preview sink before invoking the Adapter, rejects empty/loading/error Preview
states with `wechat-preview-unavailable`, coalesces concurrent requests, maps
Adapter rejection to `wechat-copy-failed`, reports
`wechat-clipboard-unsupported` separately, and suppresses late status after
teardown. A failed same-origin theme-image fetch or conversion rejects the
copy; it never publishes a partial payload.
The decision rationale and rejected alternatives are in
[ADR-001](decisions/ADR-001-wechat-clipboard-serialization.md).

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

Block-code presentation is independent from article-theme CSS. `assets/css/frontend/code-frame.css` owns the fixed cross-theme Mac frame. Code-theme assets own only block background, foreground, and Highlight.js token colors. Article-theme stylesheets retain inline code and non-code article presentation but contain no `pre`, Highlight.js token, frame, or legacy MDNice code-snippet selectors. Ordinary editor Preview, immersive Preview, revision Preview, REST-rendered content, frontend content, and WeChat export consume the same selected code-theme asset instead of defining surface-specific block-code rules.

Each article-theme descriptor exposes a Registry-owned `defaultCodeTheme`. Themes with the same effective palette reuse the same registered code theme; `fullstack-blue` retains its genuinely distinct token palette without content-dependent JavaScript rewriting. When no valid persisted or browser-session code-theme choice exists, the current article association supplies the code theme. A valid explicit choice remains authoritative across later article-theme changes. `atom-one-dark` is only the compatibility fallback for a missing or invalid association, and opening the editor performs no hidden write.

The selected code theme owns block-code presentation. Because upstream Highlight.js styles apply their background to `code.hljs`, the shared highlighter copies that computed background to the outer `pre` for generic themes after highlighting. This runtime bridge does not duplicate palettes or depend on article-theme IDs, so built-in associated themes and third-party themes registered through `easymde_code_themes` remain authoritative.

The extension filters are:

```php
easymde_article_themes
easymde_code_themes
```

Frontend EasyMDE posts enqueue:

- the EasyMDE base content stylesheet;
- the selected article theme stylesheet;
- code frame CSS only when regular code blocks need it;
- the manifest-backed code-copy script and its scoped stylesheet only when
  regular code blocks support copying;
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
- `GET /easymde/v1/theme-options`
- `POST /easymde/v1/custom-css`
- `POST /easymde/v1/custom-css/preview`
- `DELETE /easymde/v1/custom-css/{id}`
- `GET /easymde/v1/posts/{post_id}/revisions`
- `GET /easymde/v1/posts/{post_id}/revisions/{revision_id}`
- `GET /easymde/v1/settings`
- `POST /easymde/v1/settings`

Preview and theme requests with `post_id` require `current_user_can( 'edit_post', $post_id )`. Preview without a `post_id` requires `edit_posts`. Pasted-image media uploads require `upload_files`; when a `post_id` is present they also require `current_user_can( 'edit_post', $post_id )`, and without a `post_id` they require `edit_posts`. Custom CSS endpoints access only the current user's user meta, and write/delete operations require `unfiltered_html`.

Settings reads and writes require `manage_options`; updates are sanitized and persisted with the existing editor-settings option, including toolbar shortcut mappings.

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
