# EasyMDE Architecture

EasyMDE is a standalone WordPress plugin wired from `easymde.php` into `EasyMDE\Plugin`. The global `EasyMDE_Plugin` class remains as a compatibility facade for existing extension code.

This document describes the current implementation boundaries. Durable design
rationale for the React, TypeScript, and Vite admin applications lives in
[Design](DESIGN.md); it does not replace this current inventory. Development
setup lives in [Development](DEVELOPMENT.md), and release validation lives in
[Testing and Release](TESTING_AND_RELEASE.md).

## React Editor Root

The ordinary WordPress Editor is one React 18 Editor Root. PHP enqueues a Vite
loader that dynamically loads its hashed main entry. This direct cutover has no
Legacy-to-React runtime handoff. The runtime does not enqueue or execute
`assets/js/admin/bootstrap.js`, jQuery, the Legacy Toolbar, Preview, Theme,
Draft, Media runtimes, Legacy fallback DOM, or Focus Mode / immersive-writing
assets.

The React Root preserves the complete ordinary editing capability matrix while
PHP and WordPress remain the owners of publishing and revisions. A same-root
React surface may expose focused controls that delegate to those owners;
delegation is not a second persistence, authorization, or document authority:

- title and Markdown editing, Selection, IME, Undo/Redo, shortcuts, and every
  registered Toolbar command;
- live server Preview, GFM tables and task lists, Mermaid, KaTeX, Highlight.js,
  TOC, synchronized scrolling, themes, fonts, and Custom CSS;
- WordPress Media selection, Paste/Drop upload, Local Draft recovery, WeChat
  export, and the fixed Source/Preview workspace;
- the native WordPress form and unknown extension fields, permissions, Nonces,
  locks, failure states, responsive layouts, RTL, and accessibility;
- WordPress Publish, category, tag, excerpt, featured-image, and Revision
  owners, including native Meta Boxes and screens plus any same-root React
  controls that delegate to them.

PHP and WordPress retain their existing data, authorization, rendering, native
form, Save, Publish, Revision, Media, and security authority. `_easymde_markdown`
remains canonical Markdown and `post_content` remains compatibility HTML.

The shared `EditorContextMenuFeature` is mounted by this Root and binds only to
the editable CodeMirror source surface and the active immersive ProseMirror visual
surface. It is reused by ordinary Source, immersive Source, and unified immersive
Visual presentations; title fields, Settings, native WordPress controls, and
read-only Preview are outside its event boundary. The menu model
delegates Bold to the active toolbar command executor, Clipboard operations to
the browser Clipboard Port, HTML copy to the formal PHP Preview Port, table and
paragraph edits to the Markdown context rules, image scale to the seven-value
image contract, and image upload/media insertion to their existing protected
WordPress owners. The menu captures the canonical selection, blocks IME
shortcuts, rejects stale async completions, and restores focus on dismissal.
Its PHP-owned labels are part of the strict Editor Root bootstrap schema and
the static menu CSS is included by `assets/css/admin/editor.css`.
Focus Mode is not part of the default ordinary-editor surface, and the ordinary
toolbar provides the entry into the same-root immersive presentation. That
presentation reuses the ordinary CodeMirror, Preview, native form, and
WordPress capability owners. The ordinary workspace has one restrained footer
for the live Markdown character count and WordPress-owned last-editor
timestamp. Immersive Outline, expanded writing statistics, and view switching
remain scoped to the immersive presentation; Publish and Revision controls
delegate to the existing WordPress owners. The Editor Root is the layout-class
owner for ordinary, immersive Source, immersive Split, and immersive Preview.
Before it commits a new `is-immersive*` class it captures the document
session's CodeMirror scroll snapshot; the post-commit layout effect dispatches
that snapshot once. The session refuses the restore for a destroyed session, a
detached view, active visual-editing parking, or a changed document revision,
and the effect skips when the committed layout equals the captured one. The
capture and restore never change the document or selection and preserve the
intentional, including off-screen, viewport.

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

The root npm project owns Vite, TypeScript, Biome linting, React 18 development declarations, Vitest, CodeMirror 6, and the WordPress Element package used by browser builds. Exact `lucide-react@0.487.0` source is a development-only input to `scripts/generate-lucide-icons.mjs`; generated local icon nodes are compiled into the ordinary and immersive Editor interfaces without adding a browser runtime dependency. This version remains intentionally locked because the audited ordinary-toolbar contract uses its icon paths: `lucide-react@1.27.0` changes the visible Code, List, List Ordered, and Palette nodes. A future upgrade is therefore a visual-contract change and must repeat the controlled toolbar comparison. `npm run frontend:check` verifies the locked generated nodes, runs frontend linting, strict `tsc --noEmit`, component and contract tests, the test-only build contract, and temporary production comparisons for all nine manifest-backed Vite entries that must match their committed runtimes byte for byte.

`frontend/src/entrypoints/editor-block-index-worker.ts` is the dedicated local
structural Worker, built under `assets/build/editor-block-index-worker`. Its
manifest identity is not a WordPress enqueue or a second React root. The Editor
Bootstrap supplies its exact validated same-origin plugin URL. The browser
Adapter bounds input and returned source-free ranges, rejects stale results,
and terminates on cancellation, completion, failure or disposal. A debounced
document cache binds the result to the canonical source, revision and owner;
menu capture reads prepared structure without synchronously reparsing a document.

The Vite entry under `frontend/test/build-contract/` remains test-only. It proves that React, ReactDOM, and `@wordpress/element` resolve to the WordPress-provided `wp-element` runtime, while the configured classic JSX transform emits calls to its public `createElement` API instead of assuming an unavailable automatic JSX-runtime global. It also proves that Vite and WordPress manifests agree on the generated script, dependency metadata, and plugin-relative resource paths. Its output is written to `.cache/easymde-frontend-contract/`, is not enqueued by WordPress, and is excluded from the installable plugin ZIP.

`frontend/src/entrypoints/admin-editor-loader.ts` is the PHP-enqueued production loader for the ordinary Editor. `AdminAssets` validates `assets/build/admin-editor-loader/wordpress-manifest.json` and `assets/build/wordpress-manifest.json`, enqueues the stable `easymde-admin-editor-toolbar` loader handle, emits `<link rel="modulepreload">` hints for the main entry, and serializes the versioned loader Bootstrap with `mainScriptUrl` and `moduleFormat: "esm"`. The loader reads and same-origin-validates `mainScriptUrl`, dynamically loads the hashed local ES Module entry (`frontend/src/entrypoints/admin-editor.tsx`, compiled with Vite `format: "es"`, target `es2020`, reusing the WordPress 6.7 React 18 `wp.element` global via `wordpressEsmExternals()`), and starts the same React Editor Root after its DOM gate is ready. Heavy on-demand capabilities—specifically the unified ProseMirror + `markdown-it` immersive visual editor (`frontend/src/features/immersive-visual/MountedProseMirrorVisualEditor.tsx`), the WeChat Clipboard serializer/rasterizer (`frontend/src/integrations/browser/wechat/`), and secondary CodeMirror indentation language packs—are dynamically code-split into local chunks loaded only when activated. `templates/admin/editor-shell.php` provides one empty `#easymde-editor-root` mount and native WordPress submission fields. The Markdown field remains visible until CodeMirror owns a working document session; React then hides both that bridge field and `#postdivrich`, restoring them on teardown or failure; there is no parallel Legacy editor container.

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
`assets/build/settings-center/wordpress-manifest.json` contract, and dispatches
the canonical route from `load-toplevel_page_easymde` before WordPress prints
`admin-header.php`. The resulting authenticated document prints only the exact
Settings styles followed by the blocking classic
`easymde-admin-settings-center` script handle in `<head>`, then the body
fallback and one empty mount root. The entry registers its root observer before
body parsing; inserting the root therefore triggers the synchronous React
commit before the browser paints body content. It does not emit the ordinary
`#wpwrap`, admin bar, menu, content canvas, notices-before-root, or footer
presentation shell. The entrypoint requires both the exact stylesheet link and
its computed readiness sentinel before mounting. Missing server assets, a
blocked stylesheet or script, invalid Bootstrap, and Content Security Policy
failure keep a dedicated accessible error and same-origin exit instead of
falling back to wp-admin. The Settings Center has its own
Root and does not share mutable State with the Editor Root. A setting is shown
only when a real PHP/WordPress owner and browser Adapter exist; presentation
controls never claim persistence until the authoritative Settings API result
succeeds. The comment-AI and article-sync surfaces are intentionally absent
from the current navigation and DOM.

The first-paint compositor evidence binds the main-frame navigation to its
initialized loader and uses an ordered three-stage contract. It permits a
contiguous prefix exactly equal to the settled pre-navigation Settings pixels,
then a contiguous browser-clear prefix, then the new Settings frames. From the
first new Settings frame through semantic readiness, every captured frame must
remain nonblank and match the stable Settings fingerprint; fallback, wp-admin,
partial, unknown, or later blank frames fail. A reload that emits no
distinguishable new frame is accepted only when the visible Settings pixels
before and after are exactly equal across the complete analysis.

The entrypoint parses external data before mounting, constructs focused
WordPress and browser Adapters, mounts one modular `EditorRoot` (`frontend/src/app/editor/EditorRoot.tsx` composed from focused feature-bridge hooks and `ImmersiveVisualEditorHost.tsx`), and owns idempotent
teardown. The Root composes Toolbar/commands, CodeMirror document and title
sessions, the modular read-only `PreviewSurfaceOwner` (`frontend/src/features/live-preview/ui/`, with dormant windowed/editable-adoption layers retired) and local post-response enhancements, the modular immersive editor (`frontend/src/features/immersive-editor/`: `immersive-document-derivations.ts` for bounded streaming document statistics and heading-outline scanning, `immersive-publish-excerpt.ts` for Lezer-tree plain-text publish-excerpt derivation, `ui/use-immersive-document-derivations.ts` for debounced/sliced React outline and stats scheduling, `ui/ImmersiveHistoryDialog.tsx` for the revision history modal delegating restore to WordPress, plus `ImmersiveCustomCssDialog` and `ImmersivePublishDialog` lazily loaded as separate ESM chunks), Appearance and
Custom CSS, Fonts, Media and image upload, Local Drafts, the modular WeChat export pipeline (`frontend/src/integrations/browser/wechat/`),
the fixed Source/Preview layout, and WordPress session state. The independent
Settings Center Root (`frontend/src/app/settings/`) is similarly decomposed into
focused section pages and controls. Both admin stylesheets (`assets/css/admin/editor.css` and `assets/css/admin/settings-center.css`) are organized with structured tables of contents and numbered section banners. All production modules across both frontend and PHP follow automated architecture guardrails in `tests/Node/frontend-architecture-guardrails.test.mjs` and `tests/Node/php-architecture-guardrails.test.mjs`
(unidirectional layering, zero runtime circular dependencies across production frontend modules, a 1,200-line warning threshold and strict 1,500-line hard ceiling with zero legacy exceptions across all `frontend/src/` and `src/` production files, a 400-line ceiling on zero-JSX `.tsx` controllers, and PHP PSR-4/`ABSPATH`/`Support`+`Frontend` isolation).
Ordinary Editor Components depend on typed Ports; WordPress DOM, `wp.media`,
REST, Storage, and Clipboard access for the ordinary document and protected
operations remain in focused Integration Adapters. The independent Settings
Center Root is outside this ordinary-Editor inventory and may own narrowly
scoped browser APIs for its transfer and settings features.

CodeMirror owns the in-page Markdown value, Selection, Focus, Undo history, and
source scrolling. The native title and React-owned hidden Markdown fields are
synchronous submission bridges and are flushed before WordPress serializes the
open form.

### Unified ProseMirror Immersive Visual Editor

When the user unlocks immersive Preview, `ImmersiveVisualEditorHost` dynamically
imports `MountedProseMirrorVisualEditor` (`frontend/src/features/immersive-visual/`)
while keeping `PreviewSurfaceOwner` strictly read-only and hidden (retaining it as
the formal PHP `SafePreviewHtmlSink` owner for WeChat Clipboard export and lock-back
refreshes). `ProseMirrorVisualEditor` mounts `EditorView` directly onto its semantic
`<article data-easymde-prosemirror-host="1">` `.easymde-preview.easymde-rendered-content` surface via `{ mount: container }` so
every descendant and direct-child CSS selector across all 46 registered article
themes applies identically to formal Preview.

- **Single unified engine**: Handles both short and large (>160-block) documents
  in one in-memory ProseMirror projection without full/windowed engine splitting
  or DOM spacers (rationale in
  [ADR-002](decisions/ADR-002-visual-editor-and-esm-architecture.md)).
- **Zero-write on read & surgical block preservation**: Opening or unlocking a
  document performs zero canonical writes (`createMarkdownRoundTripGuard` in
  `markdown-serializer.ts` backed by `markdown-block-preservation.ts`, keeping
  the dependency direction strictly one-way from serializer to preservation).
  Localized edits preserve every untouched top-level block and untouched list
  item's original raw Markdown (including `*`/`+`/`-` bullet/task list markers,
  padded table columns, reference links, inter-block spacing, and trailing
  newlines), and undoing back to the initial state restores byte-identical
  source. `table-alignment-codec.ts` owns the TypeScript
  `<!-- easymde-table-align:v1 [...] -->` parser/reconciler mirroring
  `src/Content/TableAlignmentAnnotation.php`.
- **Protected atoms, custom NodeViews & boundary commands**: `node-views/`
  preserves KaTeX math, Mermaid diagrams, `[TOC]`, footnotes, reference
  definitions, and raw HTML blocks as non-corrupting atomic cards (with
  hover/focus Edit and Copy-raw quick actions, double-click editing,
  `Ctrl/Cmd+Enter` commit, and non-propagating `Escape` cancel), renders Mac
  3-dot code frames with incremental `Decoration.inline` Highlight.js tokens,
  supports interactive task-list checkboxes that preserve original list markers,
  and provides click-to-select image blue rings and 7-value width scaling
  (`{width=25%..200%}`). `visual-boundary-commands.ts` owns atom/container
  boundary keybindings (`Backspace`/`Delete`/`Mod-Home`/`Mod-End`/edge-arrow
  guards) and the Chromium atomic-selection anchor widget plugin.
- **Canonical synchronization, IME & source indexing**: `visual-canonical-sync.ts`
  is the single authoritative bridge between the ProseMirror projection and
  `EditorDocumentSession` (CodeMirror + native form bridge), handling bounded
  text diffs, contiguous typing history grouping, echo suppression, and
  incremental canonical Undo/Redo reconciliation. `visual-composition-session.ts`
  tracks IME `composing`/`settling` phases so canonical commits wait until
  composition ends and ProseMirror's DOM flush lands. `visual-source-index.ts`
  and `visual-source-inner-maps.ts` maintain the parser-backed bidirectional
  index between ProseMirror positions and LF-normalized UTF-16 Markdown offsets
  with lazy per-block inner maps (keeping shared segment/block types in
  `visual-source-inner-maps.ts` to avoid import cycles). Locking back to
  read-only or invoking WeChat Copy refreshes the formal PHP `MarkdownRenderer`
  Preview without making ProseMirror a persistence or formal rendering
  authority. When the formal Preview sink is hidden (`easymde-preview-surface-hidden`
  while unlocked, or hidden `.easymde-pane-preview` in source modes),
  `frontend/src/integrations/browser/wechat/wechat-payload-serializer.ts`
  serializes and measures from a temporary off-screen layout-participating clone
  of the formal Preview sink (reading only container width, never ProseMirror
  DOM) and removes it in `finally`.
React neither submits a closed field allowlist nor treats synchronization as a
successful Save, so unknown WordPress and extension fields remain intact.

### Editor Context Menu And Table Alignment

The shared context-menu Feature captures the active Source or visual selection
and delegates mutations to the canonical document and existing command/media
owners. Its formal HTML Clipboard output uses the PHP Preview owner, not a
browser Markdown renderer. The block-index cache uses the local dedicated
Worker; unavailable parser blocks retain complete provenance and never become
editable math merely because their text contains delimiters.

A demand is one gesture with one lifetime. For a Source or visual activation the
Feature first settles work the owner has already accepted from the user
(`prepareDemand`, supplied by a visual runtime and absent for Source); where the
surface maps its own pointer driven selection before readiness (Source), that
runs next, then the Feature captures the target of the gesture once, while that
element is still live, and only then reads the snapshot and readiness. A visual
owner instead maps its pointer selection inside the gated preparation that
readiness releases, which is why it supplies no pointer-selection hook. The
preflight commits the owner's own pending native input and nothing else: it maps
no selection, requests no Preview, and inserts nothing, and it runs once per
activation rather than on a readiness notification. A refused preflight ends the
gesture before any target is captured, leaving the owner's own failure as the
single report.

Visual owners return a target lease (`EditorContextMenuTargetLease`,
`captureTarget`) bound to their own current accepted source, ledger, and runtime
instance. While readiness is pending - a transfer, an in-flight
re-authentication, or a still-building inventory - the Feature keeps the parked
demand and its lease without resolving a DOM node, because the accepted render
that satisfies readiness may not be installed yet. This holds for every rebuild
of a demand, including one whose menu is already on screen: a readiness
notification is not permission to read the element the user originally pointed
at, so an accepted render that replaces that block while the menu stays open is
rebound through the same flow. Only a ready rebuild resolves the lease, and the
owner either names the live element that carries the demanded block or returns
null. Null retires the demand silently: there is no fallback to the retired
element, no lookup by reused ordinal block id, no coordinate re-test, and no
menu for a different block. A changed accepted source is therefore not silently
rebound; the block must still be provable, and a Full re-authentication that
renumbers roots still resolves the block the user pointed at. Every terminal path - dismissal, action close, cancellation,
owner or surface replacement, readiness failure, and unmount - releases the
lease idempotently, and a released lease never revives on a later notification,
so a retired demand cannot reopen or act on stale bytes.

The visible menu and a parked demand share one scroll-baseline judgment. The
baseline snapshots the surface's ancestor scroll positions
(`scrollLeft`/`scrollTop`) and the viewport's `scrollX`/`scrollY`. A queued scroll
event from a known target whose position has not changed since that snapshot is
ignored; actual movement and an unknown external scroll target still cancel. A
pending demand captures this baseline once when its user gesture opens it,
retains that same snapshot across readiness replay, and recaptures it only for a
new gesture; cancellation and teardown release it. Replay therefore cannot
re-snapshot after a real displacement and relabel it as a no-op. Menu-owned
scrolling, Escape, outside dismissal and focus restoration retain their existing
rules. The snapshot is a demand-lifetime local value, not a document store,
target lease extension or delayed-dismissal timer. It changes no menu markup or
styling.

Full also captures a structural target lease for an empty table; table commands
do not depend on a nonempty cell Text node. `currentEmptyTableTarget` proves a
direct owned root or its direct TABLE child, no read-only ancestor or descendant,
no editable Text boundary, and one `findMarkdownTable` source interval matching
the accepted row extent apart from trailing CR/LF. `captureCurrentSourceTarget`
records that whole-row anchor, and `resolveCurrentSourceTarget` revalidates the
same source, revision, owned map and unique extent before returning the live
TABLE. Only this lease, a collapsed native selection and no deliberate or
straddling range authorize `prepareContextMenuSelection` to publish the table
extent. Ordinary nonempty table carets and Media preparation keep their existing
selection guards.

While a demand is pending without a visible menu, the Feature owns Escape:
its document-capture listener prevents the default and stops propagation before
retiring the demand, so the immersive mode owner cannot also exit on that key.
This cancellation neither restores editor focus nor changes an outside native
selection. A late accepted Preview may complete its own presentation, but cannot
reopen the cancelled demand or steal outside focus. Already-prevented chords,
IME composition and keyCode 229 are not claimed; visible-menu Escape remains
with the menu UI, Tab retains cancellation behavior, and ordinary Escape with no
pending demand remains available to the immersive owner.

An accepted render may also normalize its own presentation caret: the visual
owner can adopt a newly proved block kind and publish the caret its mapper
actually found, while the canonical value and revision stay exactly the same.
That publication is the owner's, not the user's, so the lease carries one
optional receipt (`consumeAcceptedSelectionTransition`) that the owner sets
only inside that exact synchronous write and only once. The Feature consumes it
at the start of a selection notification for the initial pending demand - before
the refresh reentrancy guard - and then re-reads the demand to replace only its
captured selection, after re-checking that the same pending demand still exists
and that the surface still reports the exact snapshot the receipt authenticated
(a different post-consumption snapshot is not evidence for that transition).
Everything else stays with the existing matcher: a missing or false receipt is an
ordinary miss that lets the unchanged comparison retire or keep the demand, and a
visible menu, an in-flight action, a canceled or replaced demand, or a second
publication can never be preserved by it. Source and Windowed publish no such
transition and simply omit the member.

Nonempty selections must fit wholly inside an authenticated object's source
range before object-specific commands become available or execute. Mixed
selections retain generic text commands, not one object's deletion, alignment
or adjacent insertion. Visual preparation maps native selections inside its
owner before capturing context; foreign selections do not override clicked
object activation, while straddling or enclosing ranges reject explicitly.
These checks reuse the existing visual mapper and canonical selection owner.

Image activation is gesture-owned rather than inferred from menu coordinates. The
shared Feature decides whether a real pointer gesture preceded the `contextmenu`
event and passes that activation through the surface preparation hook. Inside
the unified ProseMirror visual editor, `image-node-view.ts` and
`visual-context-menu-adapter.ts` (`frontend/src/features/immersive-visual/`)
coordinate image `NodeSelection`, the transient `.easymde-visual-image-selected`
blue selection ring (which writes no Markdown, attributes, or export state),
pointer right-click targeting, and canonical selection synchronization. A pointer
context menu on an image targets the pointed image cleanly, while a deliberate
mixed text/object selection keeps generic text commands instead of destructive
object actions. Replacing an already-open menu retires the previous demand first,
and leases owned by asynchronous actions remain bound until completion.

A primary-button activation also focuses the visual surface, selects the image
node, and publishes the corresponding source range through the existing
same-value canonical selection update, so later commands and keyboard activation
describe the image the user activated. The visible selected state is a transient
fixed-position soft blue shadow rendered from the image's own box: it changes no
Markdown, image attribute, geometry, or Clipboard/export payload, and it leaves
the accepted-window registration, which compares captured and live surface
content, untouched. The owner keeps that shadow bound to its box through the
image and surface geometry observers, the surface structure observer, and
scroll/resize, so a late resource load, a rewritten size attribute, a Windowed
block replacement, another target, menu focus, lock/exit, drift, and disposal all
rebind or clear it. The shadow is clamped to the preview's visible band, the
viewport narrowed by the surface's clipping ancestors: while the image sits
inside the band the shadow is exactly the image's box, the part that scrolled out
of the pane is never drawn, and a fully scrolled-out image is hidden instead of
painting over the toolbar, the header, another pane, or outside the viewport.

Pointer activation of a thematic break is distinct from keyboard Context Menu
activation. A live direct-child `hr` may normalize only an absent, collapsed, or
wholly foreign native Selection to an exact node range; a deliberate owned,
mixed, different-object, or straddling range is preserved. Full and Windowed
owners authenticate source value, accepted signature/revision, edit map or
mounted ledger, block identity, editability, protection, and direct-child
ownership before that normalization, then delegate the resulting exact source
range to the existing thematic-break owner. A stale, detached, protected,
noneditable, spacer, or unmappable target restores the original Selection and
fails explicitly without a source/history write; forward and backward HR ranges
remain directional, and keyboard activation never retargets from its anchor.
Thematic breaks are parser-owned editable blocks with a packed `thematic-break`
kind appended to the block-index registry so existing numeric kinds remain
stable. Source insertion above a rule uses two detected document line endings
to prevent a following paragraph from becoming a Setext heading. Full and
Windowed Visual accept an exact direct-child `hr` `Range.selectNode` only after
matching accepted edit-map or mounted-ledger provenance; the mapper trims one
terminal line ending and never falls back to whole-surface serialization for a
stale, noneditable, mixed or spacer selection. Windowed native Delete/Backspace
uses the same authenticated source range, synchronizes the original canonical
selection before one history-isolated marker-only change, preserves line endings,
and restores the blank-gap caret through the accepted Preview. Non-cancelable,
stale, read-only, mixed and spacer paths fail without a source write. The local
browser acceptance covers the native Windowed source deletion and accepted
Undo/Redo Preview flow; exact DOM selection restoration remains covered by the
focused Windowed and CodeMirror tests.

Exiting an empty Windowed code fence between two mounted editable rows records
the exact canonical blank-gap caret, source/revision/history state, and both
source-owned neighbor extents. Local acceptance of its exact `P > BR` placeholder
already owns the gap; either side of that sole BR maps to the same canonical empty
caret. A sole-BR paragraph carries no content of its own, so its logical content
end lies before the placeholder and the owner places the native caret at the block
start (P offset 0); collapsing after the placeholder instead treats renderer
scaffolding as trailing content, which can lose native composition completion for
the gap this certificate then relies on.
Neighbor lookup may cross only retained renderer whitespace, never a spacer or
foreign root. Enter inserts the detected source line ending once, and text
arriving before its formal response must authenticate the same pending lease,
native selection, protected DOM and canonical state, not demand ready state.
Preview's local replacement adoption advances both the repository node and its
accepted sink child sequence under the same revision/signature and exact-node
proof. Loading retains that accepted sequence; retaining only the repository
would let the sink remount old HTML and destroy the pending native caret.
Owner-authorized structural mutations remain the editing presentation while a
replacement response is loading. The matching formal commit replaces that
presentation atomically; loading neither replays the preceding formal HTML nor
adopts a transient layout jump as the next scroll baseline.
A later formal renderer may omit the temporary empty paragraph. Only this
command-issued proof can restore
the same source gap at the following accepted row's native boundary; it cannot
derive a gap from a spacer, a reused block label, or an unrelated row. The
accepted proof also owns immediate text, Enter and IME insertion at that exact
caret, rather than serializing the following heading as the insertion target.
Plain-text Paste and drop at that certified caret consume the same certificate
instead of remapping the substitute presentation position into the following
row. An IME that begins while the Enter response is still outstanding keeps the
pending canonical lease; the ready-only gap path never pre-empts it, so the
draft is discarded and its committed data is inserted once at the recorded gap.
A native history command settles the pending edit before it runs: the
`historyUndo`/`historyRedo` event does not clear or replace that edit's captured
pre-edit selection witness, so Undo records the user's deleted range instead of
the transient post-edit caret, and the existing single witness owner is reused
rather than a second selection authority. Native Undo can recover a matching known gap from bounded owner history; source,
revision, selection, accepted DOM and history checks still precede reuse.
Outside focus, source ABA, navigation and pointer movement do not reacquire it.
The windowed owner issues the same certificate for a text tail, whether the
block is a heading or an ordinary paragraph, and derives the gap's trailing
boundary from the accepted source ledger rather than from a mounted node: the
next accepted editable source row supplies the exact extent even when its DOM
row is unmounted behind a window spacer, and the document-end form is used only
when no editable source row follows. A spacer never becomes a gap neighbor and
no slot is fabricated for it. The owned presentation carries one or more break
lines, so repeated Enter stays one certified gap: each accepted newline advances
the canonical source and moves the native caret to the newly created line, and
the accepted formal commit retains the gap and its caret instead of dropping the
line. Typing into that gap forms the text's own Markdown block, separated from
the following row, whose own bytes are never rewritten; a gap at the document
end, or one whose following row already owns a leading blank line, keeps the
previous direct splice. A canonical caret at a block's text tail restores to the
accepted block's visible text end, including when the formal render decodes the
draft's backslash-escaped tilde or backtick markers; an interior offset whose
source and visible bytes cannot align keeps the explicit
`visual-editor-selection-map-failed` rejection instead of guessing a boundary.
An EOF text-tail gap uses complete line-ending tokens: the producer appends
only the missing separator before requesting Preview and preserves existing
suffix bytes. The pin names the resulting canonical source, never a position
past it. A document-end boundary has no invented edit-map row. Formal adoption
rebinds the preceding row to its actual rendered source extent and promotes the
proved gap through one owner, renewing current, physical, pending and bounded
history references together. Restoring the empty paragraph's caret alone does
not authorize its next input. Both installed-snapshot adoption paths require
the same source, revision, history, selection, node identity and ledger proof.
Undo and Redo restore the authenticated gap's historical DOM before retaining
it; a live composition's extra line break cannot stand in for the restored state.
The same owner accepts `insertParagraph` while its own Preview is outstanding,
so a pending gap continues rather than rejecting the next line.
A complete fence opening at that draft's caret owns the same Enter command while
its Preview is outstanding: the shared block shortcut converts the typed tilde
or backtick opener into the equally wide backtick fence with the typed language
or info string, the canonical block text is that owner's own block serialization,
the gap certificate is retired, and the shortcut's formal request supersedes the
outstanding one. No second canonical projection is introduced for the pending
case.

Both visual owners distinguish a renderer-only structural transition from a
foreign DOM change. Full captures a bounded native end-of-block Backspace
witness at `beforeinput`: the target must run from a code block's terminal
renderer LF into a following empty paragraph. After the default it admits only
two terminal shapes: that lone LF text node removed, or a shared final text node
retained with exactly its trailing line ending trimmed; in both the empty
paragraph and any whitespace text between the two roots are gone, every
surviving root must remain the same node object with unchanged frozen metadata,
and the code root must serialize unchanged - any other inner byte change is
refused. That serialization proof is captured and compared for both accepted
shapes, not only when a shared terminal is trimmed, so a removal that also drops
code bytes or edits an inner character can never be admitted. The verified ledger is published for that commit even when the
canonical source is unchanged, because the empty paragraph's blank line stays
source and the visual removal maps to zero source bytes. The same witness gates
the equal-serialization commit and the selection mapper for that transition; a
same-id clone or any other node delta still fails as
`visual-editor-canonical-change-dom-stale`. For an
ordinary terminal empty paragraph, the one renderer-only trailing spelling
difference between the serializer and the owned visual is admitted only while the
DOM is otherwise the retained ledger; the canonical splice removes the trailing
separator, returns the native caret to the preceding text, and keeps every other
block. An emptied block whose own row is a bare block marker - a list, task,
quote or numbering marker with no text - is not spelled by the serializer at
all; that trailing marker row is the same admitted spelling difference, so the
press still names the row's canonical bytes instead of treating the surface as
stale.
For a verified native terminal join, the ordinary structural-gap path still
removes its separator; the pure-LF terminal form retires exactly one final LF
only when no following root remains, the current captured source is exact with
no shorter pending source, and the owned separator covers EOF/pure LF. Its
pre-edit actual canonical collapsed selection must match both the complete native
projection and the owned empty paragraph captured before the native default,
travel through the existing owner/source/revision proof, and be recorded as
`historySelectionBefore`; that record restores the inverse P0 and the post-heading-tail
selection. For a certified closed fenced PRE at owned EOF, the source-range path
may be absent: the owner authenticates the current code through existing
provenance/correspondence, requires a parsed closed fence with a nonempty pure-LF
tail outside it, keeps canonical EOF preselection separate from the code-body-tail
postselection, and compares the removed empty paragraph's frozen metadata before
retiring exactly one final LF through the existing history owner. Other
nonterminal, uncertified PRE, shorter-pending, and nonpure-LF joins remain
unchanged.
The ordinary fast visual-intent path that is about to write the canonical document performs
its root-ledger authentication before `applyDocumentChange`, not after it. A
retained live top-level window keeps same-node editing admissible; an already
verified native join/range/split candidate may supply the next ledger. With a
formal origin present, missing either proof leaves no verified ledger and the
transition is refused before source, revision or history can move. A surface
with no proved origin keeps its authoring path, an expanded Preview publication
keeps its separate strategy. The pre-write ledger proof only authorizes the
write: after the callback, publication still rechecks the live retained window
and then consumes a pending native candidate, refreezing metadata only for that
publication.
The owner's own published DOM/source pairing is also the baseline of a document
that began empty: without it every later press is proved against a baseline that
never existed, so publishing initializes a missing accepted visual baseline. A
Preview re-render legitimately replaces the top-level nodes it repaints, leaving
the retained node identities gone while the surface still serializes to that
same verified pairing; the owner rebuilds its ledger from those live nodes in
exactly that case. Every other node delta, and any pairing whose source,
revision or serialization no longer matches, keeps the explicit
`visual-editor-canonical-change-dom-stale` refusal.
Full does not equate a terminal DOM block with physical source EOF when
reference definitions remain hidden after it. `fullHiddenReferenceTail` keeps
the source block immediately before the contiguous trailing `LinkReference`
suffix and its immediate source predecessor for marker-row and CodeMirror-slot
aliases. Its separate `previousRendered` endpoint crosses only parser-owned
`LinkReference` nodes and whitespace to find the preceding mounted content;
neither lookup removes definitions. `ownedHiddenReferenceGapRetirement` requires
the current owner's zero-length empty-P slot, matching source, revision and
collapsed CodeMirror selection, together with the retained-DOM and serialization
proofs. `fullHiddenReferenceGapRetirement` then retires only that empty slot's
preceding separator, using whole logical line endings; the separator after the
slot, additional author blank lines and every definition remain byte-exact.
The preceding block's endpoint is independently authenticated through
`fullAcceptedEditableBlockEnd`: the current root extent, owned baseline, exact
whole-document indexed range and block kind, and accepted or current-owner
context must agree. Paragraphs, headings, lists and blockquotes may supply this
proof; code and read-only content may not. A reference-bearing row carries an
ephemeral `VisualReferenceBlockContext` containing its authenticated range,
baseline and definition context into the shared bidirectional boundary mapper.
Both directions correspond parser-visible units within that row rather than
diffing the whole document. This does not widen Source link admission: its
existing footnote-shaped-label exclusion and nesting rules remain unchanged.
Native continuation uses the existing pending range, expected clone, outside
ledger and read-only proofs; its canonical edit receipt preserves the same
certified source endpoints and definitions. The caret returns to the proved
content endpoint, not source EOF, without adding a document or history owner.
When an unchanged accepted root needs its current extent after local edits,
`currentRootExtent` first reuses the accepted decoded-row certificate and exact
equality with that root's formal accepted DOM. Its formal content extent follows
the owner's actual accepted-DOM correspondence through `fullTransportedExtent`;
numeric non-overlap lineage, not ambiguous whole-document alignment, proves the
surviving row. Current ownership, parser and accepted-baseline checks, decoded
boundary agreement and the final exact requested extent remain required.
Hidden definitions omitted by serialization do not authorize a global extent
guess, an overlapping transport or a foreign same-ID root.
For a marker-only heading, `fullHiddenReferenceSourceRow` supplies the current
parser-bounded row to `emptiedHeadingRowRetirement`; a caret within that row's
own leading whitespace separator may name the same structural boundary. The
existing structure owner still removes a facing thematic break before retiring
the emptied heading marker. Pending last-glyph input is flushed before an
empty-P or DIV boundary is classified, and `captureNativeRootJoin` yields to
that same owned-slot structural proof rather than consuming its separator as a
native join. Without an authenticated hidden tail, ordinary EOF retirement
keeps its existing source-row start priority and seam clamp; a visible Text end
does not replace that canonical EOF contract. These paths introduce no second
renderer, history owner or persistent state.
Windowed re-authenticates a real navigation selection - collapsed or
selected - inside one accepted editable code body during a pending transfer,
publishing the selection-only canonical caret with its direction preserved; a
selected deletion's target must equal that authenticated interval exactly for
both Backspace and Delete, and the post-delete caret is the interval start.

An inline protected atom — the renderer's MathML/KaTeX span inside an editable
block — is a whole canonical unit in both visual owners. A cancelable
Backspace/Delete whose collapsed caret sits directly beside that span (at the
Text offset that touches it, or at the block's own element boundary in front of
or behind it) is claimed before any caret projection: `preventDefault` runs, the
node is removed, the read-only snapshot is refreshed to the surviving regions,
and the ordinary visual merge derives the canonical range from the resulting
serialization, so the accepted render repaints and history keeps one entry per
press. The press never falls through to the browser default, whose native
deletion would remove the node without touching the source and leave the surface
describing protected regions the accepted snapshot no longer names — the
terminal `visual-editor-read-only-region-mutated` failure that made every later
key a dead press. Top-level atomic roots keep their own adjacent-root owner; this
rule covers the atoms a block still mounts.

A table's outer edge is an atomic boundary in both visual owners: a cancelable
Backspace with the caret in the block after a rendered table, or Delete with it
in the block before, is claimed — `preventDefault` runs exactly once, whether the
press proves a move or a refusal — and removes no byte. The caret moves to the
first text position of the first row's first cell (offset 0, or the cell's
element start when it holds no text) for Backspace, and to the last text
position of the last row's last cell (or that cell's element end when it holds
no text) for Delete. The table's source bytes,
rows, columns and cells stay exactly as rendered, no source or history entry is
written, and the press never falls through to a merge or to native editing,
whose default would join the facing block into the wrapper or remove the table
root.
Both owners prove the same contact before claiming it. The table must be the
renderer's own top-level wrapper for this surface (its `section.table-container`
or `section.easymde-table-container` holding a live `table`), mounted directly on
the surface and described by the accepted ledger; neither the wrapper nor an
ancestor may be protected or read-only; the caret must sit on a block's own
content edge, on a textless block whose element caret is that edge, on the
surface's own child gap, or on the table's own wrapper root; and the ordered
`visualTableDeletionWalk` must answer `boundary` for the caret's canonical edge,
which states that the source holds nothing but separator whitespace between that
edge and the table. Full re-reads the contact from the current surface after
flushing pending input and refuses a caret that no longer faces the same side;
Windowed reads it from the current wrapper and the accepted row serializations.
The placed caret is then registered as the owner's own selection
(`ownerPlacedSelectionRef`), so a late accepted transfer or a pointer demand
cannot replace the position the pressed key answered with; a failed capture
loses only that exemption, never the placement.
Inside a table, both visual owners dispatch cell-edge presses to the ordered
in-table walk before any generic pending or structural deletion owner. It
removes one cell text unit in rendered row order, stepping over empty cells.
A Backspace at the next cell's empty start therefore steps into the previous
cell and removes that cell's last text character, including the first rendered
cell's own text; consecutive presses delete that text one unit at a time. Each
unit is one history step; Undo restores the exact cell label and table source,
and subsequent input continues from the restored caret. Before the first write,
the deletion owner maps the current native cell boundary through the accepted
table source and baseline and records that point as the transaction's
before-selection; an unavailable proof refuses the write instead of falling back
to a stale canonical caret. Only
the first cell's absolute start (Backspace) or the last cell's absolute end
(Delete) is the natural `boundary` no-op, where no canonical character remains
to remove and the caret and the whole table stay in place. An empty cell is not
protected as a whole. A line break created by Enter is structural content even
when the cell has no text; a Backspace after that break is not the cell's
absolute start and must remove the break rather than be fixed at the first
cell. The owners add no table-specific Enter command and synthesize no bytes:
Enter remains native, and a proved same-cell native deletion target is released
to the existing input/merge owner. The sole Chromium placeholder `BR` still
serializes an empty cell, while authored `<br>` content keeps its existing
spelling; the rule neither reclassifies every `BR` nor rewrites author breaks.
Formal PHP rendering recognizes only the exact lowercase, attribute-free
`<br>` token inside a GFM table cell as a controlled hard-break AST node and
renders it as exact `<br>`. This does not change the global
`html_input = strip` policy: attributes, uppercase or self-closing spellings,
and every other raw HTML token remain stripped. Code spans, fences, escapes and
entities keep their higher parser priority, and `render()` and
`render_preview()` share the same converter.
The header is the
first rendered row; the Markdown delimiter row is not a cell row. The walk keeps
the table's rows and header-defined column count, and never removes pipes, joins
cells, removes the table, or automatically moves out of an exhausted table; only
an explicit user move out leaves it.
Windowed history hands a restored table caret back to its pending lease before
the formal Preview becomes ready. After Undo restores a collapsed canonical cell
boundary, the owner projects that boundary through the current accepted table
source range and serialized baseline onto the already mounted target cell's
content start or end. It only moves the native caret: source, DOM and history
stay unchanged. The projection requires an active owner, no external change,
canonical/sourceRef equal to the history markdown, equal document revision and
history state, a passing read-only snapshot and accepted DOM, a direct accepted
table with a matching serialized record, and a non-protected cell. Each cell is
mapped from the canonical table source and current accepted serialized baseline;
the collapsed boundary must match one target cell globally and exactly. A
missing, stale, protected, changed-serialization or ambiguous proof keeps the
existing lease and refuses pending input explicitly; it never falls back to the
first cell or a ready-time canonical reset. Non-empty cell boundaries use the
same source proof. Ordinary in-cell editing and the explicit
context-menu `delete-table` action remain their own owners, and protected cells
and cross-cell structural selections retain their refusal. A cancelable
`insertText`/`insertReplacementText` whose native selection or target range
spans two cells, or mixes a cell with the region outside the table, is
cancelled before the browser default: the table resolver returns the same clean
refusal as a cross-cell deletion, so no source, history, DOM mutation, failure
report or lock follows, and recovery never relies on restoring an accepted
snapshot the fresh state does not hold. A range whose endpoints both sit
outside the table is not this guard's shape.

A nonempty `TD`/`TH` element caret can instead name an ordinary in-cell deletion.
For a collapsed, cancelable Backspace/Delete with exactly one nonempty target
range in one editable Text node of that same cell, Full proves the native
element endpoint equivalent to the target's caret-facing Text endpoint. The
proof follows that node's actual ancestry; it does not select an arbitrary first
or last Text, flatten inline siblings, or cross a break or another cell. The
ordinary native-input intent then proves the canonical source units and the
accepted visual baseline as before. The live selection is not moved during this
capture; the browser's default may move it from the cell to the proved Text.
Missing, nonadjacent, nontext, or cross-Text targets do not gain that capability
and stay with the table's structural refusal. Cell-edge walks run first, so an
empty cell keeps its existing owner rather than borrowing another cell's text.
For an empty cell whose only child is its native placeholder `BR`, the table
resolver reads element offset 1 through the equivalent offset 0 using the same
source/baseline boundary mapper. It neither moves the live selection nor removes
the placeholder. Otherwise inserting a proof marker after that lone break makes
the serialization treat it as content before the marker. Cells containing text,
more than one break, or any other child do not receive this equivalence.
This scoped proof does not widen paragraph, heading, code, or general element
selection mapping, and adds no separate source map, renderer, or pending state.
In the Windowed owner, when a pending history insertion exists only in canonical
source while the accepted plain top-level cell still shows the old text, Backspace
may cancel it only when removing exactly one inserted grapheme reproduces the
whole mounted source and the live editable lease, target range, accepted ledger,
baseline and table/cell serialization all agree. Otherwise the table's existing
refusal stands. The cancellation uses the existing canonical, history and Preview
owners.
A Text caret beside a cell line break may have an element target range instead.
Full proves the target's direction-facing endpoint equivalent to that caret
through the existing DOM-boundary owner. A single owned, same-cell structural
target is previewed only on a clone of the complete accepted table wrapper;
its before/after block serialization passes through the existing source merge,
which must name one exact deletion. The existing native range witness verifies
the actual post-default root and untouched surrounding roots before committing
source and history. Failed post-default verification is not allowed to fall
through to an unwitnessed merge. Nonadjacent, cross-cell, protected, foreign and
stale targets retain refusal; Enter has no new command or serializer rule.
After an accepted native edit joins adjacent Text nodes, the history recorder
uses the existing normalized selection-path pairing so re-parsing snapshot HTML
does not lose the Redo caret.
An empty-paragraph history selection has one additional certified producer path.
When Chromium parks the native caret in a connected empty `Text` child
immediately before the sole `BR`, the owner may serialize that exact native path
back to the certificate body path only after rechecking the current certificate
owner, source, numeric revision, owned ledger, canonical collapsed offset, the
existing `0|2` extent and structural rows, editable ancestry, the exact
`P > empty Text + BR` DOM, and the snapshot's single-BR `P` through
`outerHTML`. It returns only the certified body path at offset `0`; the existing
paired selection witness and all consumer source, selection, history, and failure
guards remain in force. The certificate also carries its existing `0|2` extent
through the pending-history proof and restores the declared length; the legacy
length-2 continuity restriction is unchanged. A replaced path, non-P body, or
HTML mismatch is refused, never accepted through serialization fallback.

Table-cell native `BR` joins preserve one inline-code source span by coalescing
adjacent, same-attribute `CODE` siblings only in the serialization clone,
including caret-marked serialization. The run cannot cross its parent/cell,
protected or linked content, or differing attributes; this normalization does
not rewrite live DOM. Native target-range proofs retain the actual `CODE` or
`TD` container and its own offsets rather than interchange their coordinates.

A table serializes as one block, so the block range alone cannot say which cell
a visible run belongs to: different rows may spell the same text. The ordinary
text fast path therefore proves the run's occurrence inside the node's own
baseline cell before accepting it. It takes the node's DOM row and cell
ordinals, requires the parsed baseline table to be this block's table with the
same row shape, and bounds the occurrence by that cell's content start and raw
end. A cell that cannot be proved, a row-shape mismatch, or an occurrence
outside the cell falls back to the existing block-local marker projection; it
never accepts another cell's occurrence. When the canonical source at the
owning block is not a table at all - the accepted paragraph-to-table
normalization - the cell identity proof does not apply: the existing generic
projection owner keeps its own provenance, first-unit, protected and history
guards and still reads that accepted row. A terminal-NBSP override may replace
the live run only with its length-preserving space spelling. Real NBSPs, inline
markup, escapes, pipes and hard breaks keep their own proofs.

A marker row is not a table edge. A list item's `- `, a quote row's `>` and an
ATX heading's `#{1,6}` are renderer syntax no caret owns, so Backspace at that
row's own start is a structural join: the owner proves on a clone that the
source loses exactly the row separator and its marker run - including a
heading's closing run, which the renderer never draws - then appends the row's
inline content to the block before it and leaves the caret at the seam. A plain
paragraph's own start is the same boundary without a marker of its own: the
clone proof there removes the separator that terminates the block above, and
nothing else of the paragraph, then appends the paragraph's inline content to
the preceding paragraph, heading, quote row or list item. A paragraph that
faces a table, a fence or an emptied row keeps that edge's own owner. An
emptied heading row is the same boundary with its marker run left standing in
the source: the renderer draws no marker for it, so the row is placed by its
own accepted block range - and, when that map no longer names it, by the
source's own first row - rather than by its DOM. The empty-block shortcut
declines such a row whenever canonical content still follows it, because
rewriting the block to a paragraph has no byte to prove and would leave the
source unchanged; the structural owner then retires the marker run together
with one separator beside it, the rule an emptied list item's row already uses.
The row's block goes with it, unless that row was the document's only block:
that press leaves the existing empty-document state (`''` with its placeholder
paragraph) and puts the caret in it. A row the source ends on keeps the
shortcut's own positional removal. Where the
join cannot be placed - no block before the row, a target that cannot hold
text, a nested or protected row, a spelling that is not only markers - the
press is consumed with no write and no failure code, and a heading row that
still carries content at the document start stays a silent no-op. A genuinely
inconsistent DOM still reports its stable failure.

A certified empty-code-gap IME session also retains the Preview surface for its
own lifetime. The Windowed owner takes one runtime lease, so the sink installs
no commit and publishes no certificate for the held content, and mounted
geometry measurement cannot certify preedit height; the last release re-runs
the sink effect with the current props and restarts geometry setup for the
current state. Leases are activation-bound: concurrent sessions keep the hold
until each releases once, repeated or late releases are inert, owner disposal
invalidates them, and acquisition is refused while a materialization is already
able to roll back into the surface. `compositionend` publishes the committed
data at the captured canonical range before releasing; cancellation, both
history entry points, an external source change (including a revision ABA),
Windowed unmount, whole-owner teardown, and a late superseded response release
without serializing the draft or restoring old DOM over newer source. Ordinary
pending-caret composition acquires no lease and keeps its existing
accept-while-composing behavior.


Formal Preview may also return a versioned, line-coordinate `codeMap` from the
same CommonMark Document. It describes fenced and indented code leaves, not a
second renderer or canonical document. Code characters come only from the
parser's literal; validated original-source provenance restores CRLF, CR, LF
and unterminated final lines without reconstructing container indentation in
the browser. Changed or ambiguous source provenance makes that entry explicitly
unavailable. More than 50,000 entries or 4 MiB of body content makes the map
unavailable without discarding rendered HTML. The browser adapter validates the
map and binds it to the actual request signature; missing metadata is not
permission to infer code content from HTML or a client parser.

The independent optional `codeProjection` v1 sidecar captures reversible
physical-row provenance from that same CommonMark parse. UTF-16 offsets separate
container prefixes, parser-consumed whitespace and partial-tab virtual spaces;
each available leaf must match its `codeMap` kind and line range. Ambiguous or
non-whitespace parser consumption disables projection only, preserving HTML
and code-copy output. The contract bounds entries and rows to 50,000, fenced
info to 1,024 UTF-8 bytes, and compact serialized metadata to 4 MiB. The adapter
validates these limits before allocation and binds metadata to the request.

Smart indentation uses locked official CodeMirror language packages in a
detached EditorState, not a second EditorView or article store. Capability and
execution share the same language resolver; unavailable language services retain
disabled actions. Full parse readiness must belong to that state before the
indentation service runs. Literal payloads, blank rows and original line endings
remain protected; approved error-recovery indentation may repair invalid code.
The encoder changes only proven leading whitespace, preserves untouched raw
rows, and maps selection through individual row edits before compacting them.
Before a non-noop canonical mutation, the Root submits one detached candidate
Preview for the complete containing owner using the registered neutral profile.
The new request signature, exact semantic body, leaf/owner ranges, kind, info
and fence offset must certify the candidate before one document edit. The query
never replaces live Preview; failure, cancellation or stale selection writes
nothing. A semantic no-op makes no candidate request and adds no history event.

Source link addresses are resolved from a unique prepared link candidate through
the same protected PHP Preview Port. The query prefixes the complete candidate
to the unchanged source so reference definitions remain authoritative, uses the
registered neutral default profile, and is capped at 1 MiB UTF-8. Its output is
detached from live Preview and bound to the canonical source, revision and
selection; closing the menu cancels preparation, while a captured ready href
remains valid only for the unchanged action snapshot. Production supplies the
block-index and inert DOM-parser Ports required by this feature. An optional
Root without either does not guess link addresses or reject ordinary text
commands; a configured owner's failure follows the existing visible error path.
Visual link actions continue to use the accepted sanitized anchor owner.

Clipboard demand starts in the original menu activation. A pointer activation
first establishes the selection it must be captured with: the source session
maps the real pointer through CodeMirror's own coordinates and commits a
selection-only transaction (no document write, no history entry, no scroll),
while a deliberate non-empty selection and every keyboard activation keep the
user's current selection. That preparation runs before the demand snapshot is
read, so a demand that still waits for its inventory already describes the
pointed element instead of an earlier caret, and a replay reuses the
established selection rather than reinterpreting old screen coordinates.
Initial placement waits for the captured target's final structural inventory
through the existing index/Preview readiness owners; pending, ready and
unavailable are explicit. A visible menu survives a benign owner-drift refresh
that returns pending readiness: it keeps its captured target and anchor, does
not present the retired inventory's action context, and replaces its context
once the refreshed inventory is ready. Such a retained menu is validated
against the same document state a pending demand uses, including a
selection-only change that publishes no text snapshot, so it is retired
instead of describing a selection the user no longer has; retirement is
effective synchronously, so a notification arriving in the same batch cannot
re-match the retired capture and bring the menu back. The full model
mounts and clamps once, while later image loading only updates capabilities.
Source/revision/selection/surface changes or cancellation discard pending
demand rather than mounting a stale menu. This does not add a parser, document
store, reserved blank panel or post-mount repositioning.

Column and whole-table alignment minimally edit GFM separator cells. A bare
`---` is a null alignment, not explicit left. Independent row alignment uses
one adjacent single-line reserved comment, for example
`<!-- easymde-table-align:v1 [[1,"left"],[1,0,"center"]] -->`.
Rows include the header but exclude the separator; indices are zero-based.
Pairs set row alignment; triples set cell exceptions to that row. Sorted unique
tuples allow only left/center/right, at most 1000 entries and 4096 marker characters.
An exception requires its row anchor and a different value; a base-equal anchor
remains meaningful when it owns an exception. Row actions clear that row's
exceptions, column actions preserve non-target exceptions, and whole-table
actions remove the marker. Insert/delete shifts affected indices.

`TableAlignmentAnnotation` and the TypeScript annotation rules share fixtures.
The existing parser block index establishes comment ownership before validation;
foreign tables/code do not supply a prefix, while reserved comments separated
only by extra blank lines are orphan errors regardless of gap length. Malformed,
multiline, orphan and unsupported markers fail explicitly. PHP applies validated
alignment through TableCell attributes and controlled inline text-align; raw HTML
remains disabled. Source actions preserve unrelated table bytes, and accepted
visual provenance retains the original prefix and column base.

Local generated-content export uses a revisioned accepted-Preview lease and
the existing visual rasterization Port, independently of WeChat serialization
and image uploading. PNG Clipboard writes are initiated by the explicit user
action; formula MathML comes from the accepted KaTeX output. The editor does
not expose a browser-download or Save-as-PNG context-menu action. Ordinary
image copying has a separate pixel Port: it reads the certified,
already loaded same-origin image without fetching, reloading, changing image
attributes, or uploading. Source range, ordinal, accepted revision, node order,
and complete image fingerprint must remain current until output publication.

Immersive visual Preview editing synchronizes the editable surface back to the
canonical Markdown document. Completed block and inline Markdown shortcuts are
applied to semantic visual markup before synchronization; pasted plain text is
inserted as Markdown and rendered only by the authoritative server Preview
owner. A Preview response is enhanced in one connected, inert staging element
with the active Preview's theme and width context, then handed to the active
Safe HTML sink as one revisioned node transaction. React keeps the accepted
enhanced HTML in state while the sink remains the sole imperative child owner,
so a later rerender cannot roll the committed subtree back. The same-props
early return also proves the surface still holds the HTML that was installed:
a native edit that changed `surface.innerHTML` without a new revision is
reinstalled from the accepted HTML instead of becoming the next baseline, so
the visual standard never drifts from the canonical source by a byte. The accepted
enhanced subtree remains visible while the request, math, Mermaid, and
Highlight.js work is pending.
Plain-text Markdown transfer from Paste or Drop flushes pending visual input,
maps the current selection, and applies the insertion through the canonical
document owner before requesting server Preview. It passes the existing
code-structure validation record for the new Markdown with the `matchesPreview`
flag false, so transfer does not repeat the full code-topology scan and any prior
code-body map remains untrusted until the replacement Preview is accepted.
Per-key visual source, history, and native-field projection owners remain
unchanged.
An accepted empty Preview discards the previous window repository, pending
window commit, and pending materialization work; any superseded materialization
resolves `false`. `materialize()` reports readiness only for an accepted ready
Preview. Without a repository it returns success only when no materialization
is pending, no actual spacer remains, and the accepted state does not still
require a large window. Non-ready, unavailable-repository, and stale-repository
paths return `false` with the stable diagnostics
`preview-window-materialize-not-ready`,
`preview-window-materialize-repository-unavailable`, and
`preview-window-materialize-repository-stale`. Ready materialization is
installed by the Safe HTML sink in bounded batches; completion, failure,
supersession, empty replacement, and teardown resolve every pending result.
Immersive teardown waits for an accepted pending transfer but does not require
full-surface materialization or start an abandoned Preview refresh. Manual
“lock to read-only” is the same teardown caller: it synchronizes the canonical
source and leaves visual editing without requiring full-surface materialization,
so a not-ready render neither blocks the lock nor becomes a readiness error.
The lock then shows the ordinary read-only Preview; a visible windowed
presentation is restored to the complete read-only surface with its scroll
position preserved, and unlocking remains gated on the ready state. While a
Windowed transfer still owns the surface, the existing protection refuses a
lock whose source cannot be safely synchronized, leaving source and history
unchanged. Ordinary Preview retains ownership of its own materialization and
truthful failure reporting.
Full-surface materialization holds the current activation against background
window commits so mode handoff and export consumers can use the complete DOM.
The `windowed` false-to-true layout transition releases the previous activation's
hold before window setup, including an immersive Source/Split/Preview round trip;
ordinary rerenders, scrolling, and resizing do not release a consumer's hold.
Repeated full-surface materialization is idempotent for the accepted request: a second unlock does not create another canonical edit, history entry, or duplicate mounted root. The same hold and ledger rules cover an immersive Source-to-Split-to-Preview round trip, preserving the accepted source, selection and renderer whitespace ledger while the complete editable surface is restored.
This does not bypass an in-flight sink commit: window setup still waits for
bounded materialization. Completion clears its commit key and reruns setup;
failure publishes its stable diagnostic and error state, and the Root cancels
the queued unlock and clears its busy control. Setup, scheduling, and committing
retain these same hold guards rather than racing the Safe HTML sink. The next
admitted unlock accepts a measured window before enabling and focusing the
editable pane. Root snapshot revisions count accepted snapshots, whereas Preview
window generations advance on each request state (loading and success); those
clocks are not compared as if they were one revision sequence.
Within one accepted Preview window epoch, a ready viewport reorder's installed
snapshot may be consumed synchronously before the next input, before Root's
window-generation render reaches the consumer. This handoff uses the current
accepted identity rather than restarting the input owner; canonical source,
numeric source revision, signature/revision, exact node order and
protected/read-only proofs still gate adoption.
View changes remain Root-owned. If a formal visual transfer is pending, one
Source click records the requested mode until that transfer settles, then uses
the same guarded preparation and materialization path as a direct switch.
Every explicit Source, Split or Preview choice supersedes older requests,
including a choice of the current mode. Preparation rechecks that request after
each asynchronous boundary; cancellation releases only its own window hold and
restores the still-current editable Preview, never an older mode request.
Exiting immersive Preview uses that same generation owner: when a formal visual
transfer is pending, one exit request waits for its authoritative acceptance and
then runs the guarded source preparation before leaving. A newer explicit mode
choice supersedes the pending exit, and teardown drops it; neither path creates
an extra document, selection or history transaction.
Window spacers are repository-owned declarations of the unmounted range they
cover. Full-surface materialization consumes a spacer batch by batch, advancing
its declared start and scaling its block size in place before removing it, so a
cached spacer can outlive the run it was created for. The repository re-declares
that range, block size, and margin pair whenever it hands a cached spacer out
again, which keeps every installed spacer's declaration equal to its mounted
neighbors; a mismatch fails the window commit with
`preview-window-flow-spacer-neighbor-invalid` instead of installing an
inconsistent window.
Fence shortcuts are a presentation command: a newly formed tilde or backtick
opener that can be represented as valid backtick syntax is serialized as an
equally wide backtick fence while its info string is retained. Accepted or
pasted tilde fences retain their source family. Inline shortcuts skip `CODE`
and `PRE` content, block shortcuts skip code bodies, and the serializer scopes
list, image, and caret-marker cleanup outside code.
Full Visual projects a literal opener from the already authenticated native
caret. Equal raw spans use linear boundary proof; raw or mixed backslash-escape
spellings use a bounded Markdown-unit walk in both canonical and visual text,
not a fresh global text search. An owner-created idless paragraph may become an
empty code block only through the synchronous command's exact owned-node,
source/revision, prior-HTML and lexical-span witness, with unchanged neighboring
source and a validated empty code placeholder. This local command authority does
not refresh an older formal edit map or admit foreign same-ID replacements.
A complete opener typed into an ordinary paragraph stays literal until Enter,
including its info string and at document end. The paragraph-line projection
escapes the whole marker run without consuming neighboring blocks. Enter uses
the authenticated literal row's exact source span and the command-created empty
code block's serialization, not a second merge of escaped paragraph spelling;
its source revision, owned-node ledger and neighboring source remain guarded.
Rapid input is identified by its native input type, not insertion length; a
coalesced burst projects its actual grouped source and selection rather than
replaying the last key's splice. The caret remains between the newly inserted
prefix and the pre-existing text, without double-escaping or splitting the
history group. Verbatim Paste and already established source fences keep their
existing owners.
Accepted escaped literal rows use one bounded correspondence for source-to-DOM
restoration, native-to-source input and unchanged-Source preparation. Each
endpoint's accepted marker row must match its complete source slice through
greedily paired Markdown escape units, including escaped backslashes; endpoints
inside a unit are rejected. A BR represents a newline, protected descendants are
excluded, and offsets consistently count UTF-16 code units. This paragraph-wide
proof restores tails, info-string interiors and later-line positions through
formal Preview rematerialization and native Undo/Redo without adding a history
event. Native anchor/focus order supplies direction, including backward ranges
across Text nodes, independently of the sorted source endpoints. Once input and
its selection are committed, Source preparation preserves canonical Markdown,
selection, document revision and both history depths; a stale hidden Source
caret may only be synchronized to the proved current native selection through
the existing same-value operation. Uncertified or ambiguous merges still fail
explicitly; this certificate is not a wider serializer or merge fallback.
Block-shortcut feedback animates opacity only: a newly adopted root must retain
measurable normal-flow coordinates while the bounded Preview window certifies
its replacement geometry. The geometry owner still rejects unmeasured transforms;
it does not delay editing admission or substitute estimated geometry to hide a
presentation animation failure.
Preview scroll snapshots belong to their request generation. The existing
ratio-based restoration runs after that generation's accepted DOM commit reaches
ready; loading and enhancement do not consume it. Failure, supersession, and
teardown discard the snapshot. A ratio is never captured while a commit is still
committing or enhancing, because that state holds the transient DOM and scroll
restore in flight; and a request that carries a Preview-owned selection pin is a
current edit whose own anchor owns the viewport, so its ready commit does not
replay the previous review ratio over the already painted edited row.
A Preview window selection pin owns only the source rows that own the selection
endpoints. It never pins every interior row and never raises the fixed
materialized cap. The canonical source selection, direction and history remain
unchanged. A whole-document history selection is presented as one native
surface-root selection across the mounted window. A partial selection whose
intermediate rows are window spacers is restored from its two mounted endpoint
rows, with the native range spanning them. These are distinct contracts: a whole
selection is not converted into a partial endpoint range, and a partial
selection is never widened to the whole surface. Range replacement, deletion and
Undo/Redo use the complete canonical interval with its original direction and
bounds even while interior rows remain unmounted.

A live non-collapsed native range over protected inline content is claimed by
the visual input owner, not by the last published canonical selection.
Acceptance requires a fresh accepted map, live block identity, unchanged source
and revision, an exact native target range, endpoints outside every protected
region, and every intersected protected atom wholly contained. Full and Windowed
then perform one replacement with the mapped source range and history selection.

For that input action, a partial intersection, an endpoint inside protection, an
unowned or external range, a stale snapshot or an unproved map is refused before
the browser default and writes no source, history or DOM. A selection or context
preparation refusal may restore the accepted surface through its existing owner,
but it does not change canonical body or history and never reports success. An
ordinary deletion the owner cannot map is refused silently, with no lock and no
failure report, so typing continues; a restoration the owner attempted and could
not complete - a decline that cannot prove the owed caret or a restore that
threw - is the one deletion failure it reports truthfully
(`visual-editor-deletion-repair-failed`), because every later press would
otherwise be refused with nothing restored.
When that restore installs fresh accepted nodes, the owner rebinds the restored
ledger and accepted correspondence only under the current accepted source,
revision, signature and edit map, so the next legal edit and Undo continue from
the restored surface instead of an old node certificate. Windowed pending
pointer and context-menu preparation share that selection-only read purpose:
it may map a whole-contained range without turning it into write authority, so
an actual edit still goes through the whole-contained write gate and a partial
range cannot be edited through either read path. An otherwise unowned native
range is not itself a context-menu refusal:
Root's existing foreign-route policy may route it to Formula and publish a
same-value canonical selection without a history entry; that route does not
authorize a visual body replacement. Typed literal text keeps the existing
serializer-owned escaping rather than introducing a second Markdown encoder.

The Windowed Root does not wait for a positive-height layout box. A finite block
rect with at least one client rect is a valid zero-height presentation (for
example an empty blockquote); no estimated height or CSS/geometry substitute
can satisfy readiness. Geometry preparation carries its revision, style and
width epochs and cursor across bounded work slices, and every resume rechecks
owner, cancellation, node order and epoch before measuring. Flow-boundary
capture is strict: the full materialized child sequence must be connected and
direct, all flow and gap epochs must be current, edge nodes must be free of
presentation transforms, and surface/edge coordinates must be finite before
publication.

Measured window geometry has one publication owner: the repository operation
records the measured model height, advances the flow boundary, invalidates the
spacer cache and marks the block and gap epochs with their known ranges. Staged,
mounted, preparation and adopted-block callers keep their own node and rect
validation, measurement, scheduling, cancellation and error policy, and consume
the returned anchor correction; they do not repeat the transaction.
Large candidate population and visual block marker passes yield when measured
work reaches an eight-millisecond slice budget, checking cancellation and the
current Preview owner after each yield. A large final handoff retains one paint
barrier before the atomic sink commit.
Layout-dependent code-frame variables are synchronized once against the active
surface after that commit. Supported `beforeinput` edits use captured source
and visual ranges to apply one localized canonical transaction. A cached
interval map is retained across an accepted paste; a unique visible text node
with an exact one-to-one source range takes the hot path without cloning,
serializing, diffing, replacing the Preview root, or requesting Preview.
Ambiguous edits fall back to the strict serializer and merge path. A paragraph
whose whole text is a fence run is never a real fence: every marker paragraph,
standing alone or adjacent to others, keeps the escaped spelling whatever info
string follows and wherever the block sits, and no adjacency is exempt. Raw was
measured to be parsed as a real fence by the formal Preview while the surface —
and a reload — still hold a paragraph, so raw does not round-trip; the failure is
not local to the row either, because the formal renderer reads two raw rows as a
single FencedCode that also consumes every row after them. Two adjacent rows,
three adjacent rows, an info opening followed by a bare row and a single row at
the document end are therefore all escaped, and the plain parser reads every
escaped row back as a Paragraph, never as a Fence. A raw run belongs only to a
real `PRE` code fence, which has its own serializer rule. Every writer — the
commit publish, the pending draft, the certified-gap draft and a native signed
insertion — spells its row through this same single-row paragraph projection, so
a one-row probe writes exactly the bytes the whole-document serialization
writes; the canonical source and the block baseline stay byte-identical at every
keystroke instead of a per-character merge escape. A paragraph whose whole text is the
fence opening the block Enter command owns keeps that key ahead of any
source-neutral text-tail gap and of an outstanding Preview; every other
paragraph and heading keeps the existing gap and line-break owners. When the
block shortcut replaces a
paragraph with the code frame it draws, the commit publishes that frame's own
serialization at the accepted row position with the row's trailing separation
preserved and the caret on the frame's empty body line, instead of merging a
replacement across an escaped marker row. That positional publication proves
the row with the shared escape-unit walk (every source byte consumed, the whole
row reading back as the frame's opening line, so the writer's partial escaping
of the run is the same line) and with the parser still seeing one plain
paragraph, never any other construct; a row that reads a different line is
refused to the strict merge. A literal
native insertion at an authenticated collapsed paragraph caret may instead
splice the captured bytes once at that caret when the serializer's spelling of
the change differs from the typed bytes and the pre-edit text maps exactly onto
the source prefix (backslash escapes included); the splice preserves both
source neighbours and is refused unless the resulting run stays plain
paragraph text. Chromium's terminal-space NBSP is admitted only as an alias for
an ASCII source space: the original text is proved first, and only a failed
proof retries the NBSP-to-space candidate for the same unit-exact prefix, so a
source-owned NBSP keeps its own spelling. The inline strong shortcut may
complete a raw `**` opener with the typed closing star when the resulting
source parses as the same StrongEmphasis run. For an
image-bearing native input, the eager image-token proof is shared with any
interval-map construction in that same input event; unchanged image elements
reuse their serialized fragment spelling, and an altered image is proved again.
The same authenticated paragraph proof also projects a toolbar selection after
a background native flush; non-proof shapes keep the strict marker mapper.
Leaving immersive Visual asks that projection for the caret too, so a fenced
block's indented body line is part of the proof. The renderer strips up to the
opening fence line's own indent from every body line, the serializer writes the
fence back at column zero, and those stripped columns are therefore hidden
source bytes that end exactly where the body's first drawn character starts. A
pure insertion at the end of that leading column is accepted and answered at
that first drawn character when the run is spaces only, closes the line's
leading column rather than a window inside it, is followed by drawn text on the
same line, sits inside one fenced block's body rather than on either delimiter
line, and is exactly the lesser of the fence's own indent and that line's own
indent (`fenceIndent`, read from the opening fence line). Every other
hidden-boundary insertion keeps `visual-editor-markdown-merge-ambiguous`: a
press at the run's own start, an edit that is not a pure insertion, an opening or
closing delimiter line, a tab-led body line, an all-blank body line, an indented
code block, and a run that does not close the line's leading column. This is one
proven boundary, not a widening of the hidden-boundary guard.
This does not cache the document map across different source/baseline pairs or
relax image and reference-definition checks. A supplied
interval map is accepted only for the exact canonical source and visual baseline
it was built from: equal normalized text does not prove that its recorded hidden
ranges, original offsets, or escape gaps still describe these bytes, and that
identity check runs before the unchanged fast path. One change that may be
treated as a serializer no-op is one recorded escape gap — a single backslash the
alignment recorded directly before source-owned escapable punctuation whose two
endpoints still map to that source offset — and it is proven after, never before,
the hidden-range overlap and boundary checks, so a new visual slash or an
unowned gap stays a real edit or an explicit failure. One additional no-op covers
a serializer-normalized framing gap: a changed run of horizontal whitespace whose
missing start or end lies between two mapped offsets that resolve to the same
source anchor, where that gap carries zero source width, the run has no actual
replacement, and the anchor's own source line is blank or quote framing only.
Code context, hidden source ranges, serializer escape gaps, and an anchor used by
any real splice in the same merge retain the strict refusal, so real body edits,
list-indentation changes and every other unmapped boundary are never absorbed.
Three further framing completions follow the same proof discipline: the
serializer-inserted escape, its inverse presentation, and the completing
backslash of an existing run. A bare
escapable punctuation byte committed by a quick intent stays bare in canonical
source; the merge absorbs the serializer's one leading backslash only when the
edited alignment records that gap at the insertion, baseline and edited still
carry the same original byte on both sides, the character is escapable
punctuation, and both unit boundaries hold. An existing literal backslash run is
absorbed the same way only when the run is odd, the serializer appends one
backslash to make it even, the baseline spells that same run, all three unit
boundaries hold, and the bytes on both sides are unchanged. The inverse
presentation is the third: the canonical source already spells an escapable
punctuation with an odd backslash run while the stored baseline shows the raw
glyph, and the surface's escaped spelling is then an echo of those source bytes
that is kept byte-for-byte. A real backslash key serializes as two characters
and never satisfies the single-backslash proof.
Table-cell content escapes a literal `|` with parity-aware, idempotent `\|`
spelling while the GFM column index still reads the row's raw `childNodes`. A
pipe typed inside a cell chooses its canonical spelling from the parity of the
backslash run already before the caret: the run becomes `2n + 1` backslashes
plus the pipe, so an odd run keeps the pipe an escaped cell byte and an even run
can never turn it into a new column; the recorded visual spelling uses the
serializer's own parity for the run the DOM actually holds. A paragraph pipe
stays bare bytes, and no other inline gesture changes.
A task-list row's checkbox spelling comes from the serializer, not from the
intent's arithmetic visual, so a fast insertion anchored inside a task list
records the serializer's own spelling as the committed baseline and pays one
whole-surface serialization for that commit. A block-fragment comparison cannot
prove the document: another identical task list can carry the same fragment.
No other press takes that path, and structural deletions keep their existing
baseline contract.
A deferred visual commit never outlives the state that mapped it. While a
Preview adoption can rebind the canonical session, a deletion in the top-level
paragraph directly after a table container commits before the debounce, so the
pending intent cannot be rejected as stale and leave the surface changed
without a source edit. Teardown flushes any pending intent before the owner
reports itself inactive for the same reason. Every other deletion keeps the
existing debounce and its history grouping.
These framing no-ops do not relax the hidden-range, escape-gap, or real-edit
checks, and they do not restore per-key whole-document serialization.
A collapsed deletion may
reuse its remembered run when the canonical source or accepted visual baseline
contains that run and its endpoint/source-unit proof still agrees. This avoids
whole-document alignment for those authenticated spans, not for every soft
break: raw LF text and a browser-folded space are different spellings, and a
span that crosses their mismatch still needs interval projection and can be
refused. A caret-adjacent
single-character Backspace proves its one source unit from the caret's own
authenticated boundary, so deleting rendered punctuation that the source
escapes removes the escape with it without building a whole-document
alignment; any other span keeps the interval projection. Ordinary
visual input uses a trailing 80-millisecond debounce, composition cancels an
older pending timer, and lock, view changes, autosave, publish, toolbar, and
teardown flush pending input before their owner runs. Within one input/commit,
the same exact source reuses one bounded read-only code model (line starts,
code blocks, body intervals and structure signature) instead of re-parsing
it; a different source or code ordinal recomputes from scratch. If the
serialized visual Markdown is unchanged, the transition flush skips selection
mapping and document synchronization entirely. A changed transaction requires a current
or previously accepted visual selection and never silently appends at the end
when mapping is unavailable. Focus restoration uses `preventScroll`, and a
pending paste blocks `beforeinput` without toggling the active surface's
`contenteditable` state. History and composition input never re-enter the
shortcut parser. Consecutive exact text input may continue through its pending
source projection. A successful flush re-captures the current connected
Selection before mapping that same `beforeinput`; failed or stale mapping
rejects it explicitly. When a prior browser mutation is pending without such a
projection, the next `beforeinput` first synchronizes that structural DOM
change. This keeps a rapid list split followed by text in the new item from
mapping through the pre-split source interval.
Full composition settlement binds the insertion to its witnessed native origin,
source and revision. It corrects the insertion-end caret only while the native
selection still equals the captured completion witness; a newer pointer or
Ctrl/Cmd+A selection is mapped as the current selection instead. Both visual
owners initially invalidate a pending formal transfer's selection/focus restoration
on new pointer or selection-navigation intent, so later acceptance cannot replay
the old caret over it. A queued Full composition callback also checks its own
effect-local lifetime before committing or restoring selection: teardown
retires that closure even if a new activation makes the shared runtime active.
Full may renew that null selection lease only through its new trusted native
keydown token and matching trusted keyup after the browser actually moves the
selection. It re-proves the current source, revision, history, previous selection,
owned DOM and protected regions. Exact equality of the origin and current source
permits identity mapping after Undo; otherwise the endpoints require the existing
numeric non-overlap transport. The same owner publishes the canonical direction,
the pending expectation, the paired `visualSelection.sourceSelection` and any
history-selection witness together, and drops any positive `selectionOrigin` the
transfer previously carried. Acceptance consumes that pair only for a `history` /
`plain` transfer: when present it must equal the expectation exactly or the
acceptance is stale, and a matching pair always forbids the owner's
pointer-replacement privilege independently of any positive origin. It never
treats the pair as an authored origin, and a positive origin never overrides it.
Acceptance still places the normal accepted range. A primary pointer press on
effective editable text acquires the activation-bound composition-surface lease,
so the Preview sink installs nothing while the gesture is in flight; this is not
a tag test - link text, inline code and PRE bodies are ordinary text, while IMG
and form controls keep their existing owners and captured read-only regions never
acquire. The hold is released by the matching pointerup, pointercancel, focus
loss, Escape or teardown; only a trusted, unprevented, same-pointer completion
with the surface still focused may publish, and it reuses the full pending
completion proof before release (or the ordinary selection sync when no transfer
exists). A cancelled or unprovable gesture publishes nothing and never replays
the earlier expectation; the hold never authorizes a canonical write by itself.
No movement, untrusted or
prevented events, drift, foreign or stale DOM, and blur do not renew the keyboard
lease.
The pending structural writer and the pending history replay carry the same
operation correspondence. A structural write with no prior transfer
authenticates the settled accepted origin and the exact change descriptor,
publishes the post-write revision/history binding, and keeps that origin ledger
as the operation origin while the new source has no mounted current pairing; it
never claims the old DOM spells the new source. A pending history replay composes
from the retained presentation origin or, when none exists, the prior transfer's
correspondence origin, and only while the prior source, revision and history
exactly describe the state being replaced. Missing, stale, foreign, read-only or
descriptor-mismatched evidence publishes no correspondence, and the shared
completion refuses instead of falling back to a guess.
This does not change the existing normal-input admission routes or turn a null
lease into permission. Pending history acceptance re-proves the expectation's
recorded revision whenever its producer recorded one, whether or not the transfer
also carries a history proof.
An unchanged preparation read preserves a locally owned plain paragraph's
composition authority only after re-proving its source, revision and retained
DOM ledger. If serialization changes the visual spelling, the same row's exact
DOM prefix and whole-unit projection rebase its selection memory; accepted
renders, history replacement and unproved rows retain their retirement rules.
For a marked paragraph root, Full composition first asks the accepted formal whole-row mapper for a decoded certificate. Only when that certificate is unavailable may a current Full-owned plain `P`/`Text` root use the existing same-pair local literal certificate, and only when that certificate succeeds; otherwise the formal or interval path remains authoritative. A repeated block ID alone never grants local ownership, and the source, revision, retained DOM ledger and native memory must still match the witnessed composition.
When the source and visual baseline are unchanged, the neutral structural
selection exception accepts only a collapsed caret in a sole-`BR` `P` or `LI`
body. The body must be bounded by unchanged non-structural anchors or validated
source ends, and its DOM ancestry must match the Markdown parser's ordered
blockquote/list ancestry with exactly one owned separator. Code or protected
content, missing ownership, and ambiguous candidates never claim this mapping;
recognized failures use the existing merge errors. A valid candidate projects a
zero-width source boundary into the interval map before the existing marker and
merge checks run. Ordinary content remains eligible for the cached unique-text
hot path before this structural scan.
For typed input at that neutral boundary, `beforeinput` must capture the exact
collapsed target range and body path before the browser transaction. It first
updates only the canonical Selection through a same-value document operation;
source bytes and history depth remain unchanged before native mutation. The
following `input` accepts only the same live target/body path and boundary, the
expected native empty-placeholder-to-Text transition, unchanged DOM outside the
body, and an unchanged protected snapshot. It then serializes the actual surface
as the visual baseline and enters the existing edit-intent and history owners.
After that serialization, the visual caret offset is recomputed from the actual
surface through the pure marker mapper rather than from the predicted
replacement, so selection memory remains correct for escaped `~`, `*`, `_`, and
`\` input. If another character arrives before the empty-body transaction
commits, the earliest `historyBefore` and original `baseSourceMarkdown` remain
authoritative; the existing canonical value diff applies the accumulated source
once without a full-source scan or global history annotation per key.
CRLF comparison uses normalized intervals and converts the result back to the
canonical source UTF-16 offset. Immediate and delayed next input plus Undo/Redo
must retain paired canonical and native Selection points; stale or mismatched
evidence fails through the existing explicit synchronization owner.
If a pending code-body intent is still owned when the Selection leaves its code
block for an empty structural `P` or `LI`, the existing `beforeinput` owner
flushes that code intent before dispatching the structural selection-only
update, then rechecks the current owner. Consecutive input that remains in the
same code segment continues through the existing pending code owner.
Empty-structural capture verifies that the committed source reference and
canonical document remain equal before and after that update; a mismatch fails
with the existing stable `visual-editor-history-document-stale` error before
native input is accepted.
When the generic map cannot project a collapsed caret inside CODE, the existing
code-body projection owns only that caret input; non-collapsed selections retain
the generic owner.
For a mapped fenced or indented code block, the visual editor resolves the active Preview
segment to one Markdown source body interval. One visual block may contain more
than one code segment and PRE. The code-body structure identity is the
accepted visual block plus that segment's code ordinal, never the block ID
alone, document order, language, or body text. A sibling segment in the same
block resets the pending base source and interval witness instead of inheriting
them, and commit-time expansion resolves the PRE from the input's code-body
topology (with a block-scoped fallback), not from the block's first PRE. The
Windowed owner applies the same identity against its bounded source-range
adapter and accepted ledger, and restores a pending caret, DOM split, newline
or empty-body continuation only for that segment. No path collapses several
code segments in one block into a continuous body. Both visual owners derive a
code-body mutation's canonical range from the shared code-body source edit:
a deletion that consumes a complete terminal empty body line also consumes
that line's container prefix and terminator, including CRLF, while the caret
and source-offset mapper still resolve the empty line's code start after that
prefix. Other content deletions and insertions keep their exact source bytes.
Indented leaves, including quote/list children, use the structural parser's
`CodeBlock`/`CodeText` ranges and line-prefix geometry in that same inventory,
even in a document with no fences. Their interval kind is `indented`, with no
fence/info or open-EOF state; delimiter expansion and local fence provenance
remain fenced-only. Full routes deletion of the last indented content through
the structural code-shortcut synchronizer: it removes that leaf's own source
extent once, records the native pre-operation caret and DOM snapshot for Undo,
and publishes synchronously with the command's proven owner-result ledger.
It does not require a canonical-command map from an older formal Preview.
Nested retirement replaces the leaf in place, retaining the top-level root and
all sibling node identities. The existing structural command carries an
in-place mutation proof: outside-leaf node metadata and child order must remain
unchanged, and only the parent's proven leaf position may become the empty
paragraph or be removed. Protected content in the leaf or its ancestors still
refuses retirement; unrelated protected siblings are neither cloned nor replaced.
The retirement decision uses the current PRE identity and a collapsed canonical
document selection whose source-to-code offset round-trips inside the leaf.
The canonical body and that offset, not potentially lagging DOM body offsets,
prove the last-character deletion. Current-source correspondence, revision,
owned DOM and protected-state checks still apply. Only when that authenticated
PRE's body text disagrees with the canonical body does its pre-operation history
slot use the existing `rematerialize` path: Undo restores exact source and the
canonical caret through formal Preview instead of resurrecting stale body HTML.
Ordinary body commits and matching-body structural removals retain snapshots;
fenced history is unaffected.
Indented source-bound edit witnesses validate complete line geometry, prefixes,
terminators and empty-body metadata by value. Rebuilding the bounded exact-source
memo must not invalidate an otherwise identical witness merely by allocating a
new `bodyLines` array; changed geometry still fails closed.
Chromium spells a significant trailing space inside rendered CODE as U+00A0
while the canonical source keeps U+0020. Visual-versus-source comparison of
inline and block code text therefore runs one directional, position-only rule
in `visualCodeTextMatchesCanonical`: a canonical ASCII space may match a DOM
U+00A0 at the same index, and never the reverse. The rule changes projection and
verification only; it never rewrites a value, and edit spans are still spliced
from the original bytes, so an authored U+00A0 or entity keeps its exact bytes
and any other difference still refuses.
An authored nested empty paragraph retains the exact blank container rows on
both sides of its canonical anchor in the existing empty-paragraph provenance
and history owner. Backspace prefers the preceding row; Delete prefers the
following row, with the other adjacent row available when that side is absent.
The destination is proved against the current owned source/visual pair before
any DOM or selection mutation; renderer whitespace is never a caret target.
The authenticated post-command surface spelling advances the current HTML and
history pairing without advancing the formal map certificate, so a later
refusal cannot restore the retired leaf from older Preview HTML. An uncommitted
authored mutation is rolled back on refusal with both selections preserved.
It does not relax the ordinary
code-body structure-signature guard or reserialize the document per key.
Lezer's string input treats only LF as a line break, so the model replaces bare
CR with LF only in its parser input, one UTF-16 unit for one unit; geometry and
edits still address the original source and preserve its actual terminators.
Accepted indented-body selection endpoints, including Undo, resolve through
that row's own PRE ordinal and code-body source offsets before generic marker
mapping. The projected code text and source endpoint must agree exactly, and
the boundary's editable ancestry remains required.
A Windowed pending deletion consumes that edit's `from`, `to`, `insert` and
`sourceCaret` directly and preserves the same prefix and Undo/Redo semantics;
it does not rebuild a raw offset range.
That
interval owns blank-line and
line-ending semantics for both ordinary and windowed immersive editing;
browser-created code DOM nodes are reconciled to the source interval without
using their child count as a Markdown line index. Terminal and pending-window
deletions resolve the same authenticated interval - derived from the accepted
ledger row, never from document order, language or body-text matching: a
forward Delete past the body's last character is recognized as a terminal
target and consumed as a structural no-op that keeps the caret in the code,
while an invalid or stale target keeps its explicit rejection, and a deletion
between a history transfer and its formal Preview re-proves its block before
any canonical write. The document session remains
the canonical value and history owner. Non-windowed visual history slots follow
CodeMirror's actual Undo/Redo depths, including grouped events, history pruning
and replacement of a Redo branch. A slot retains an exact DOM snapshot or marks
an accepted source state for formal Preview rematerialization. Ordinary exact
text input does not serialize the whole DOM or reuse stale accepted HTML to
manufacture a snapshot. Exact snapshots restore code DOM and caret after
browser-created formatting or a scripted terminal newline is normalized.

Windowed pending fenced-body text splices use that raw interval, which already
contains any existing container prefix. `applyPendingCanonicalText` prepends the
prefix only when the original raw body is empty and computes the caret from the
prefix actually inserted; literal prefix text and untouched source are preserved.
This path prevents native insertion and updates canonical source/lease selection
before requesting formal PHP Preview, retaining the old code DOM/native point
only as an identity witness. New code presentation belongs to formal acceptance;
a ready native-owned local text commit need not request PHP Preview, so ready
state alone does not certify a current PHP source/map.

Full paragraph topology fallback serializes and indexes element roots, while
retaining renderer whitespace Text nodes in the exact owned child-node ledger.
It verifies that ledger before omitting whitespace from block serialization;
foreign replacements, changed whitespace data and non-whitespace root text do
not gain authority. A pending pure insertion extends both source-extent edges
only for its actual insertion-owning root. Prefix and suffix bytes are rebuilt
from the real operation descriptor; another root's boundary insertion is
excluded, and an ambiguous unowned empty extent is rejected.
Full heading-tail Enter and witnessed native paragraph splits preserve the
canonical bytes outside the exact insertion, including inter-block gaps and the
terminal LF. The heading Enter window is proved by shape alone: one inserted
empty paragraph directly after the heading that stood at that position before
the command, with every other node the very object it was. That proof needs no
accepted block identity, so a surface whose accepted render carries no edit map
- and therefore no identities at all - still admits its own heading command.
A newly empty paragraph has a source-owned two-space body; the next native
character replaces that body rather than inserting at a neighboring code block.
When a browser's native insertion leaves the original empty-
paragraph `BR` after the new Text node, that witnessed Text+`BR` shape remains
the owned immediate-input presentation; it is not normalized away before the
pending edit settles. Its operation-issued source/revision and node witness
also covers a terminal paragraph omitted by serialization. Chromium may instead
insert a cloned sole-`BR` paragraph immediately before the original paragraph
while retaining the original suffix `P` and `Text`. The same signed beforeinput
witness admits that order only when the original node identity, frozen sibling
ledger, source/revision and both exact fragments agree; a repeated block ID
alone never grants ownership. Native pre-edit carets enter the same CodeMirror
history event. A known target history snapshot may restore an omitted empty
paragraph only at its exact source gap after the accepted renderer proves the
surrounding rows. When a Full owner is torn down after proving such an
Enter-created empty-P history target, its successor may receive only a bounded
source/depth/offset and history-depth continuity descriptor keyed to the same
document session. The fresh owner still re-proves the current source, canonical
point, accepted map and neighboring gap before presenting the empty paragraph;
it retains no DOM or article snapshot and writes no extra history step. Source
changes, history-depth changes and other document owners retire that descriptor.
A collapsed caret at a shared boundary belongs to the next paragraph's exact
source start; noncollapsed ranges and fence endpoints keep their existing
mapping. Plain heading restoration ignores only trailing line endings, never
internal lines or offsets beyond its proved text.
Full accepted-source restoration also proves a renderer-omitted leading column
on each endpoint's own paragraph clone. In
`placeVisualSelectionFromAcceptedSourceRange`, only the documented selection-map
failure may use this proof: an editable paragraph with one to three leading
ASCII spaces, no following space or tab, an endpoint within that exact run, and
a serialized body byte-equal to the source after removing that run and terminal
CR/LF projects to the same clone's offset zero. The existing whole-source-unit
and clone-to-live node-path proofs still apply. Collapsed and noncollapsed
history selections share this endpoint proof; their canonical offsets and
direction remain unchanged. Different body bytes, NBSP, protected descendants
and unproved offsets retain the original failure.
At physical source EOF, the same accepted-source endpoint reader serves
collapsed and ranged history restoration. A documented boundary-map failure
may use the terminal parser extent only when the accepted editable row ends at
canonical EOF, no later editable row exists, no protected ancestor or descendant
is present, and the suffix beyond that parser extent consists solely of source
line endings. The accepted row serialization must prove the remaining source
body through the existing spelling-equivalence contract. This certificate maps
the DOM point at the semantic end; it neither slices the canonical document nor
changes its endpoint, range direction or terminal line endings. Hidden reference
definitions are not an EOF-terminator alias. Unproved offsets retain their
original mapping failure.
Under that same certificate, collapsed restoration retains the existing accepted
Text-end presentation through the pure document-edge reader. Ranged restoration
first tries the semantic decoder and uses that reader only for its documented
mapping failures. The reader returns a point without collapsing Selection;
normalized row spelling does not require weakening the source/body proof.
For native replacement of an owner-placed whole-source range, the existing Full
pending range model requires the matching native target and selection, current
canonical source, owned DOM and complete editable-root coverage. Its ordinary
empty ancestor-shell proof remains limited to attribute-free empty paragraph or
blockquote clones; text, `BR`, markers, attributes and protected content do not
become empty shells.
An additional source-EOF certificate models the formal renderer's exact terminal
blockquote shape: LF, an attribute-free paragraph containing the selected Text,
then LF. The accepted owner, map, revision, signature, terminal parser extent,
source-only line-ending suffix and byte-equal serialized body must all agree.
The native model records the retained original quote and closing LF as one exact
residual container, not authored quote content. Verification requires their node
identities, captured attributes, single LF child and precise root count; every
other selected root must disconnect. Outside nodes, including the original
top-level LF, retain their identities and complete snapshots, and the surviving
first root must still equal its complete expected root exactly. This is not a
global whitespace/blockquote exception or a relaxed node-count check. Only the
detached expected suffix is adjusted; live DOM is never trimmed.
The same canonical edit receipt replaces the whole selected source from the
surviving first root's serialization, preserving its formatting rather than
writing the renderer residual as a new author quote. The old selected terminal
line endings are replaced, and the original selection is recorded for Undo.
For ordinary Full beforeinput, a direct nonempty plain paragraph's Element
caret at its start or end and its equivalent Text boundary are interchangeable
when one collapsed native target proves the same Text node and offset. For
Backspace/Delete, `nativeVisualTextSelection` also accepts one noncollapsed
target in that same editable Text node only when it is adjacent to the proved
caret and `equivalentNativeBoundary` authenticates the Element/Text endpoints.
The existing interval or decoded-block mapper still proves the source units.
This captures the first native deletion after an owner handoff, including a
digit deletion that exposes Chromium's terminal NBSP spelling, rather than
letting an uncaptured serializer commit trim an additional source space. The
owner does not mutate the DOM, guess a neighboring Text node, relax generic
merge guards or repair the later symptom by changing source authority.
A retained pending-history presentation may instead be a noncollapsed range over
one direct nonempty plain paragraph, with the paragraph's own Element edge at
one endpoint and its sole Text boundary at the other. Those two spellings are
interchangeable only when both the live presentation and the native target
normalize to the identical Text node and offsets for start and end, so they
authenticate the same exact span rather than a class of paragraph selections.
The same focus, current canonical source/revision/history, owned DOM, retained
read-only snapshot and protected-endpoint checks still decide; a generic `P`
wrapper or a nested/mixed paragraph is never admitted, the live selection is
never collapsed or reset, and the edit is written through the canonical
source-first owner at the recorded canonical selection.
For an authenticated empty paragraph containing only its renderer BR, native
`P:0` and Chromium's post-deletion `P:1` identify the same empty insertion point.
The existing input owner normalizes its captured structural target, preserving
source/revision, exact ledger and target-range checks; it does not move the live
caret before the native default or admit an unowned empty paragraph.
Full table presentation has a separate known-history proof; it is not an ordinary
edit origin relabelled with the history target's source or revision. Before a real
CodeMirror Undo/Redo, the owner authenticates the source-owned current DOM and
protected state and captures a coherent pre-command origin. After the command,
the actual target source, numeric revision, selection, both history depths and
exact existing target-slot identity bind that one pending transfer. A previously
proved paragraph-to-table presentation retains only its owner, exact source-row
extent, mapped first-header offset and source in the existing history snapshot.
Unknown or source-only slots cannot mint that capability. A native Undo
restores the operation's own inverse range; that ordered range is the same
authenticated pre-command origin as a collapsed caret. The target source,
revision, both history depths, exact slot identity and presentation still bind
the one pending transfer, and only that table presentation may normalize the
target caret to its mapped first header.

The formal Preview still supplies a fresh accepted map and protected table root.
`acceptTablePresentation` revalidates the pending transfer, current owner, exact
known slot/source/revision/selection/depths, and one editable row matching that
source extent; old block IDs are not authority. Detached row serialization,
interval-map endpoint proof and editable ancestry still prove the first nonempty
header Text boundary. Ordinary-edit normalization additionally requires its
trusted collapsed paragraph origin; known-history replay instead requires the
ordered paragraph origin authenticated before that command. Both require an
eligible collapsed target caret. It places
the native and canonical point at the positively mapped header offset without
changing source, document revision or history depths, adding a history entry or
issuing another render. The exact row end is inclusive; row-end-plus-one is not
an EOF fallback. Ordinary representable history selections keep their existing
placement path.

An existing known anchor also survives fresh ordinary or ranged history
placement: the `retain` path reauthenticates that same anchor against the newly
accepted protected row and offset, then returns it before reading or changing
native focus, selection or any receipt. The fresh snapshot explicitly keeps that
same provenance without reordering the history ledger; retention never creates
new normalization authority or collapses a deliberate range. Thus Undoing a
table mutation may restore its ordinary row range, Undoing the earlier deletion
may restore the malformed paragraph, and Redoing that deletion may still use the
previously proved table presentation. The context-menu action has already
dismissed and released its demand before these native history commands: neither
history placement nor anchor retention rearms that lease or its one-shot
accepted-selection receipt. CodeMirror, the existing history slots and the
formal Preview remain the sole document/history/render owners.

Native mapped text intents carry their already-proved pre-key source selection
into the same canonical transaction as their edit and post-selection. A deletion's
target range is not its native caret; the existing boundary mapper supplies both
independently. CodeMirror records the explicit inverse and post-selection without
a preliminary selection write, DOM serialization or extra document history entry.
This prevents a stale hidden Source caret at a trailing neighbor from becoming the
table promotion's Undo/Redo caret.
In the two hybrid delete-intent constructions, the validated code-body
`historySelectionBefore` is copied after the generic intent spread only when that
proof supplies it; an absent value leaves the generic inverse intact. The derived
snapshot and selection-witness identity checks remain authoritative, and no
adapter, grouping, or permission behavior changes.

Full history pairs a native Text path with a captured HTML snapshot only while
the surface's mutation epoch still matches that snapshot. The existing code-order
observer owns this epoch as well: its callback and every synchronous record drain
share one consumer, so Text, attribute and child mutations invalidate pairing
before a new input can use it. Only a fresh surface HTML capture may stamp the
epoch; inherited accepted HTML cannot. Token mismatch grants no native-path
pairing through a serialization fallback. Adjacent-Text normalization keeps its
separate structural proof, and teardown revokes the epoch and observer.

History snapshots also record whether their accepted Preview was mapped. An empty
current Preview cannot make a previously mapped snapshot restorable in place:
Undoing the last table's removal requests a fresh formal map and restores its row
range there. The existing table anchor's retention proof binds the authenticated
pre-command source even when that accepted empty origin has no map certificate;
it cannot borrow a third source's inventory or manufacture a new anchor.

An in-place history replay (Undo/Redo restoring its stored snapshot) also rebinds
`visualSourceIntervalMapRef` to the restored source/DOM pair, and the same
commit's caret marker proof reads that image-aware alignment whenever the caret's
top-level row mounts an `img` and the alignment carries `imageUnits`: the plain
text alignment cannot map an image spelling boundary, so a restored row whose
caret sits beside an image would otherwise refuse the next key after the value
merge had already accepted the same bytes. This grants no new admission - an
unproved or unit-less alignment keeps the existing unmapped refusal, the second
image's source range is still never guessed, and no other inline gesture changes.


For an exact canonical deletion in the Full visual owner, a replacement
certificate may retain the verified native Range's Text-node path and offsets.
It never searches for matching text. Removing an empty loose-list paragraph
certifies its surviving list item, rather than manufacturing a paragraph or
line break that the formal renderer does not emit. Acceptance checks the actual
canonical revision, history and selection, source range, serialized fragment
and mapped caret before restoring native selection. Nonempty Markdown
insertions and other structural changes use the existing canonical mapper from
the outset; serialization failures are not converted into fallback success.
When pending visual input leaves a list or blockquote body empty,
`commitPendingVisualIntent` has already materialized that body and updated the
accepted HTML, source map, and visual baseline. The current history slot records
that existing surface through `recordCurrentVisualHistorySnapshot`; it does not
replace the valid snapshot with a formal Preview-rematerialization slot. The
next native character and local Undo/Redo therefore use the snapshot path, and
protected-order adoption preserves equivalent generated node identity without a
formal Preview request. A formal Preview request remains required when no valid
local snapshot exists.
Targets without a local snapshot, including history before the visual baseline,
use the formal Preview owner bound to source, signature, history state and
selection; native contenteditable history never owns Markdown. Restoring an
empty code block rehydrates its placeholder Text
before capturing the visual Markdown baseline and restoring the caret. A
failed snapshot caret restore rolls the canonical history change back.
Accepted open-EOF fences retain source-derived ending metadata. Serialization
removes its synthetic closing delimiter after Turndown, preserving code-tail
whitespace and source-owned line endings. Code-body commits refresh this
metadata; the windowed source-range adapter restores it for the active region
through the same proof as setup. That proof parses the full canonical source
once and takes each fenced leaf's absolute interval, exact family/info, and
container ancestry from the structural Markdown parser. A mounted PRE is written
only when its owning root's accepted interval contains the leaf's opening line
and its own DOM container path matches exactly one leaf path inside that
interval; an unbound or structurally ambiguous root keeps its current attributes
and is never cleaned globally. An open-at-EOF claim additionally requires the
complete canonical interval, so a region that ends before the canonical
document end can never claim EOF and is rejected explicitly instead.
An actual empty-code Backspace shortcut flushes pending input before its
structural change and records the corresponding canonical history transition.
Focused windowed structural edits prepare a Preview-owned selection pin
before scheduling its exact formal Preview request. The in-memory lease binds
the request signature, source selection, and accepted generation. A selected
source range may be non-collapsed; Preview maps both endpoints to the relevant
editable block indices before the atomic first window commit and preserves
those indices in subsequent bounded windows. After the matching commit, the
windowed owner restores the canonical Selection direction as well as its
endpoints. A canonical EOF selection still uses the document-end form of the
same lease.
The windowed commit also preserves an ordinary, collapsed text caret whose
selected root is being replaced, not only a caret inside a code body. Before
children are removed it maps the live Text point through the accepted block's
source range and serialization to the block's canonical source offset, then maps
that exact source offset back through the candidate block's own serialization.
It installs the existing selection-handoff protocol only when the source,
revision, value, selected/candidate node identity, HTML, block id and both
source slices still agree and that round trip names one unique target point.
The code-body handoff remains its own branch. A stale or foreign source, an
out-of-range or ambiguous point, a protected node, or a failed round trip is an
explicit handoff failure rather than silent selection loss; a newer user
selection is never overwritten by the commit's asynchronous result. No canonical
selection is forced after ready. The lease releases after caret restoration or cancellation, error,
or teardown; invalid range, map, generation, signature, and owner transitions
remain explicit Preview failures.
Focused native Windowed Undo/Redo also acquires the existing source-selection
pin for collapsed non-EOF points, including a thematic-break boundary outside
the currently mounted window. The matching formal render must mount and restore
that exact canonical point before releasing the lease. Outside focus acquires
no ordinary history pin and is never reclaimed. Unmappable source, stale state,
protected content and failed mounting keep their explicit failure paths; an
editable surface alone is not evidence that a history selection restored.
A native cut followed by Undo restores the deleted text, and the browser keeps
only the collapsed caret it applied the history step to. Only when the pin
restores a **collapsed** caret does the owner certify a `historyInsertion` point
with it, and only then is immediate typing accepted at that point instead of at
the pre-Undo position. A pin that restores a **non-collapsed** selection — the
cut's own block range — does not itself certify an insertion caret. Without the
separate current-replay code proof below, the placeholder row cannot supply a
unique landing point: the pending-input gate refuses it
(`target-range-mismatch`) and leaves source unchanged. The ordinary certificate
itself is taken from a
carried-forward certificate while the caret still sits at that certified
boundary, or else from a one-block probe of the caret's own block against its own
block-fragment serialization — only while the mounted source is still the
canonical source — mapped through the history step. Only line endings may
separate the caret from a pinned selection edge, and a paragraph block compares
through the same paragraph-boundary equivalence the placement recorded. An
attached direct BLOCKQUOTE endpoint uses the same block-fragment serialization
for its marker clone, so its `>` prefix is part of the compared source boundary.
A detached direct blockquote is not self-authenticating; only its article
fragment container may certify that endpoint. When
neither the recorded range nor the row's node identity describes the caret,
because the restored rows are not mounted, the pending-input gate accepts the
event only if both the event's own target range and the live caret prove that
same certified position. A caret that moved since the gate, an unproved block
boundary, or a target/live mismatch keeps the recorded selection or refuses the
event (`target-range-mismatch`, `multiple-targets`), so an unproved history caret
never widens the insertion: the proof fails closed and the event stays unowned.
A collapsed ordinary insertion at an inline anchor's true label end has one
additional owner check. The native caret and the input target must both name the
same anchor Text boundary, and that boundary must equal the accepted block's
structural text end, including nested strong/code content; trailing read-only,
image, break or otherwise non-text descendants do not qualify. Only then does
the owner prevent the browser's default, which otherwise can place the character
in a new sibling text after the anchor, and insert into that same label Text
through the existing inline intent/commit path. An explicit caret outside the
anchor, a non-end offset, a composing or non-cancelable event, and stale or
foreign state keep their existing ownership and fallback behavior. The link
source mapper and URL rules are unchanged.

For immediate code-body input after Undo restores a deleted fence,
`runHistory` instead proves the actual native replay against the current source:
one insertion must equal the restored noncollapsed selection, and removing it
must reconstruct the pre-command source exactly. The current
`createEditorMarkdownBlockIndex` must identify that exact editable top-level
`code` interval; generated Mermaid, math, unavailable and nested roots do not
gain code ownership. `PendingHistoryInsertion.codeBlock` carries only the
current interval and revision. `pendingInputLease` rechecks that revision, live
editability, the certified native point and equivalent event target together
with the existing source, history, selection, focus and read-only guards.
`applyPendingCanonicalText` then uses the existing body projection and fence
expansion, retaining the current lease through continued typing and history.
This is current replay/source-index proof, not a bounded array of historical
whole-document snapshots or a second history/provenance store. Empty-code-gap
input likewise preserves its canonical prefix and suffix separators and derives
its caret from source-encoded spelling, including escaped Markdown markers.
When history restores HTML inside the same operation-owned PRE, `runHistory`
also restores the current history selection through the existing
`placeCodeBodySourceSelection`. The same physical owner, current empty-gap and
presentation proofs, source-bound code range, focus, editability and protected
state must still agree, with no composition in flight. The body's parsed
interval must contain both endpoints and differ from the retained source range
only by line endings at its edges; direction is preserved. A PRE element caret
at offset zero is not guessed to mean the body's end, and this restoration
creates neither a new lease nor a fallback cursor owner.
For a pending deletion inside an operation-created code gap,
`applyPendingCanonicalCodeBodyDeletion` requires both
`emptyCodeGapMatchesDocument` and `emptyCodeGapPresentationMatchesDocument`,
live editability and a nonprotected presentation. The native collapsed state
must match the lease; `projectVisualCodeBodySelection` must prove both native
source endpoints equal the lease selection, including direction for a range.
The event target must cover that complete native and leased interval. A
noncollapsed deletion never falls back to a single insertion caret. The
Windowed `applyDocumentChange` also rechecks live `isEditable` for an actual
source write, while a selection-only update retains its existing permission.
A second Backspace at the start of that now-empty owned frame uses the existing
`visualBlockShortcutRewriteTarget` and `applyVisualBlockShortcut` structural
owner, including when its CODE contains the single renderer line ending instead
of a strict placeholder. The same operation gap, current source and HTML,
capability and protection proofs must hold; the canonical fence must be closed
with an empty body or its one line ending, and both lease and native selection
must be collapsed at body offset zero. The target may name only that equivalent
code-start boundary or the existing authenticated corridor from the gap's own
preceding block's semantic end to code start. `equivalentWindowedBlockBoundaries`
proves that corridor; an interior point, forward Delete, nonempty body,
read-only state or old revision cannot authorize this exit. Removing the frame
preserves its source gap and places the canonical paragraph caret at
`draftSourceStart`, not a `blockStart` inside a separator, so immediate typing
remains an independent paragraph through Undo and Redo.
An EOF history reconstruction migrates that presentation's child certificate,
not just its visible caret. `prepareHistoryGapPresentation` first proves the
complete old accepted child identities and the old owned presentation HTML.
It derives the replacement list by removing only the existing owned gap and
document-end sink, authenticates the current before/after anchors, and only then
retires the old presentation and inserts the new paragraph. The new certificate
describes exactly that physical replacement; unrelated live children are never
recaptured as accepted. In `runHistory`, a rejected reconstruction uses the
existing report and `onTransferFailure` channel while preserving notification
of the canonical history change that already occurred. A foreign child or
forged anchor cannot gain input authority through this reconstruction. The
restored EOF paragraph remains a source insertion point after its complete
separator, so immediate input stays in that paragraph through Undo and Redo
rather than editing the preceding block or a separator interior.

A canonical removal that takes whole blocks with it (a context-menu code-block
or thematic-break deletion) reports its caret where the removed block started.
An editable block's ledger range ends at the next block's first line, so it
includes that block's own trailing line terminator while the removal keeps it:
such a block counts as consumed when nothing but whitespace survives inside its
range, not only when the removal covers the range end. Both owners commit the
nearest surviving editable boundary instead of that whitespace, the following
block while the document still has one and otherwise the preceding block, so
the canonical history selection, the Preview selection pin or accepted transfer,
and the native restoration all describe one mountable position. The Full owner
computes that one committed selection from the accepted edit map through the
shared `projectVisualMarkdownRemovalSelection` projection, records it in
canonical history with the write, and binds the same selection into its Preview
request, so Undo and Redo restore the accepted post-removal position rather than
a re-mapped or unrepresentable one. Pinning still accepts a collapsed position
no editable block covers, through the same source-whitespace owner the removal
projection uses: the following editable block owns the pin, otherwise the
preceding one, but only while the source between the caret and that block is
blank. Native restoration stays strict: a selection the accepted window cannot
mount remains an explicit failure reported once per event, and that recovery
never applies to a non-collapsed selection, generated or unavailable content, or
a stale map.
The visual surface keeps code-fence delimiter lines as `data-easymde-visual-fence`
metadata instead of DOM text, so a history selection whose endpoint sits on such
a line has no visual boundary of its own. Source projection maps that endpoint
to the owning code segment inside the block instead: its start for an opening delimiter line and
its last representable offset for a closing one, proven from the source block
structure together with the live fence metadata. The Windowed owner maps each
endpoint on a clone of that endpoint block, so the fence metadata may sit on the
mapped root itself rather than on a descendant. When that root is the fence block
itself, its boundary space starts at the code body and omits the opening
delimiter line: `visualCodeFenceRootSourceOffset` translates the source offset
into that root space before mapping, so an endpoint inside the code body resolves
to its own boundary instead of an offset the root can never produce. The formal
renderer publishes fence markup without fence metadata (this owner restores it
from the source during capture, after the accepted mapping has run), so the
mapping clone receives the fence metadata its endpoint Markdown proves through
`applyVisualCodeFenceMetadataFromSource`; the clone then serializes back to that
Markdown instead of its code body alone. Offsets
without that proof keep the explicit selection-map failure. A candidate walk that
exhausts its 32-attempt budget still reaches that proof: the budget error is
caught at the walk, and the source-proven recovery is applied once. A mapped
lower neighbour may advance only through a contiguous text run whose normalized
source bytes equal the requested source slice; otherwise the block-end or
same-owner upper-boundary proof is used only for a source-only region, and an
offset no proof owns rethrows the original budget failure unchanged.
An accepted-source caret can land on a fence's opening delimiter or info line
after a paste, where the accepted map has no visual boundary for it. The
accepted-caret recovery then projects that offset to the start of the owning
code-body interval inside the same editable block, proved from the source interval
(`visualCodeBodyIntervalAtOrdinal`), the accepted ledger row that owns the body,
and the code DOM's own body text; it never falls back to another block, the old
Selection, or the document end. The correction is presentation only: the
accepted source bytes, revision, Undo depth, and Preview request stay exactly as
accepted, the same value is recorded with the recovered selection so no history
entry is created, and the recovered position is reported through
`onDiagnostic` (`visual-editor-selection-restore-projection`) rather than a
failure. Stale, render, protection, history, and non-collapsed failures keep
their existing explicit failure path.
A canonical caret at the document end sits one line terminator past the last
visible character. When the last accepted block's source range owns that byte,
the block-local projection has no node that represents it, so that call fails
its documented mapping check. The accepted placement then uses the accepted
document-end presentation, and only while the source ends with a line
terminator, the last accepted block's range ends at the canonical document end,
no later accepted block is editable, and that terminal row's own serialized
Markdown equals its source slice with the terminal line terminator removed. A
same-id row whose text was replaced, or that cannot project onto its slice at
all, fails that proof and keeps the original mapping failure. The placed caret
must be the accepted terminal row or inside it; any disagreement with the
accepted map or ledger rethrows the original mapping failure. The accepted source bytes, revision,
Undo depth, and Preview request are unchanged, and this branch never applies to
an empty accepted source or to a fence body, whose own projection resolves
first.
A preview-only surface never hands the visual caret to the canonical session,
so the history slot captured at mount keeps the selection that session happened
to hold then while the user's caret sits elsewhere. Before the first accepted
input of a debounce group, the owner captures the operation's own pre-edit
native caret as a witness together with everything it was read against: the
canonical source and revision, the history depth, the accepted Preview identity
and HTML, and the exact slot object whose render is still the live DOM. Nothing
is written at capture time, so a cancelled input cannot alter history. The
witness travels with the pending intent and is applied only by the commit that
retires that slot, and only while every captured fact still holds - a different
source, revision, history depth, accepted identity, accepted HTML or slot object
is an ABA, a replacement or a foreign acceptance, and the slot keeps its own
recorded selection. Later characters of the same group inherit the witness by
that certified origin, never by the rolling pending source, so the group's
earliest pre-edit caret is the one kept. The witness is captured for every
authenticated generic input operation, ranged and structural edits included, so
the slot records the position the user actually started from rather than a
per-input-type whitelist. The canonical commit records that same caret as the
inverse of its history event, so an in-place Undo restores the authored position
in both owners instead of the untouched mount-time selection.
When that exact request resolves to a document at or below the Windowed
threshold, the owner releases the matching lease and continues the normal full
staged commit because the complete DOM already contains the editable EOF.
Stale, superseded, or identity-mismatched leases still fail through the
existing Preview error path.
The Windowed visual owner and Preview surface remain paired until the restored
history selection is committed. If the canonical history still has a Redo
branch, that pair remains active until Redo obtains its next document-end lease
or a new local edit discards the branch; failure, exit, and teardown clear it.
For an ordinary threshold crossing, Root also keeps the outgoing Windowed owner
until its pending transfer settles, so owner and Preview projection change
together rather than mounting Full on a still-windowed sink. The Windowed
choice is not permanent. A real active-owner switch increments Root's existing
`visualResumeCanonicalToken` and supplies
`resumeCanonicalSelectionOnOwnerTransfer`; no independent selection or history
store is introduced. Full restores the current canonical selection through its
accepted-source mapper instead of preserving a legal-looking caret created by
replacement DOM; ordinary unlock still preserves a legal owned native caret.
Windowed consumes that same explicit request and monotonic token once, restoring
through `restoreMountedSourceSelection` or the existing `requestFormalPreview`
selection pin when the target is unmounted. Its operation callback retains no
document, selection or history snapshot, and token rerenders do not tear down
the owner or lease. Read-only state, foreign focus and newer user navigation
retain their existing cancellation and ownership rules.
Generated Preview roots may carry non-editable zero-width source ranges before
or after editable roots. Code-body mapping skips those ranges, and document-end
pinning selects the unique last editable root that reaches canonical EOF.
For a transformed non-code final root, EOF restoration may collapse at that
validated live root's DOM end only when every following mounted root is the
corresponding protected non-editable output; ordinary and PRE mapping remain
source-projected and fail explicitly on ambiguity.
Temporary browser Selection is not a pin across Safe HTML child replacement.
After the final editable block mounts, a collapsed EOF
caret may project to that block's text end when only source line endings remain
outside its mapped range; omitted content or an unmounted final block fails.
Mapped code Enter handles both `insertParagraph` and `insertLineBreak` in the
existing code node before Chromium can split it into multiple `code` children.
The projection and reconciliation accept exactly one renderer-only terminal LF
difference in either direction between editable code DOM and Markdown; multiple
line-ending differences or changed content remain explicit failures. Markdown
retains the delimiter line ending. Composition flushes pending exact
input before it starts, and a rejected code-map composition remains rejected
through its end. Successful exact code edits retain per-`pre` recovery snapshots
so failure recovery restores DOM consistent with canonical Markdown without
serializing the complete document on each keystroke.
Native neutral code spans are accepted only when each has no attributes and
exactly one direct Text child. Projection reads this shape without mutation;
reconciliation unwraps it using the same Text node and preserves Selection.
Other unsupported markup remains an explicit failure.
The source reframe path and serializer share outer-fence length selection, so a
literal complete fence run in the body remains content by widening the outer
delimiter. The source interval, DOM fence family, caret, and history snapshot
advance together. Both visual owners restore their accepted DOM or window
region after rejected noncancelable composition, without writing that mutation
to Markdown. Windowed code Enter reconciles Chromium's split code nodes through
the captured body intent; Enter and a following character retain the canonical
owner's separate history transactions.
An unclosed fenced block is mappable only when its accepted editable Preview
range and source interval both reach EOF. Pasting a bare opener preserves its
bytes; the first body edit supplies a missing line ending without adding a
closing fence. Literal fence content widens the opener while preserving that
open state.
Canonical and visual opener prefixes are computed independently: an accepted
paste may retain a bare opener while the mounted visual snapshot already has
its line ending. Each caret offset includes only its own inserted prefix.
Before a native windowed edit or IME composition changes the DOM, its visible
selection is synchronized through a same-value canonical update. Code
selections use the accepted code-body source projection. This gives Undo the
actual pre-edit caret without adding a document change. Nonempty code edits also validate the
accepted PRE identity; a stale replacement is rejected and restored before
source publication.
For a captured ordinary text deletion, `syncVisibleSelection` reuses that
operation's source proof instead of serializing the row again after a terminal
SPACE/NBSP presentation change. Source, canonical value, numeric revision,
region bounds and the one retained Text node and its data must still match;
the collapsed native endpoint must be the captured target's own caret-facing
edge. Backspace uses the source target end and forward Delete its start.
Read-only state is rejected explicitly. Generic, selected-range and code-body
preselection paths keep their existing owners.
Windowed visual document edits opt in to recording their post-edit selection
through CodeMirror's selection history. This adds no document Undo step and
keeps Undo/Redo selection with the canonical history owner. After the matching
Preview is ready, the bounded mounted region receives that source selection;
absolute offsets are converted once, with explicit adjacent-block and EOF
ownership. Generic source-to-DOM lookup returns a node and offset without
mutating Selection on detached clones.
When CodeMirror has replayed a literal replacement but its mounted accepted
paragraph still presents the pre-replay Text, `runHistory` invokes the internal
`restoreLiteralHistoryForeground`. Canonical replay first proves the exact
post-history row extent and unchanged outside-row bytes; pure insertion and
deletion then return immediately to the existing structural history owner.
This dispatch precedes old-row DOM authentication because image Undo/Redo still
presents the browser's deletion DOM until its accepted Preview restores the
image. A foreground paragraph that contains an `img` also returns to the
existing image/structural selection owner for an image-token replacement such
as a title or destination change; canonical token bytes are never projected
through a visible Text. Only a literal replacement authenticates the
before/after source,
accepted row and epoch, complete old DOM spelling and attributes,
child/protected snapshots, history, selection and live editability. Its actual
minimal delta must replace part of the same Text. Existing source-unit
and inline-code mappings must prove the complete Text and both endpoints before
and after replay. A detached working clone proves the replacement without adding
a renderer or cache. Live reconciliation uses only that Text's `replaceData`
and refreshes the accepted row record, preserving Text, CODE, paragraph and sibling
identities; the existing `restoreMountedSourceSelection` restores direction.
If a canonical-only pending edit already presents the target spelling, the same
full-Text and endpoint proof avoids applying it twice. Foreign nodes or children,
changed old text, stale epochs or replay, and read-only state retain rejection.
Subsequent pending navigation still requires the existing gesture-bound renewal:
source, revision, history, old selection, current DOM and protection must agree
before canonical selection and the restoration lease advance together. A missing
gesture or null lease is not an input bypass. This adds no port or shared owner.
Windowed plain paragraphs use `windowedPlainParagraphBodySource` to derive a
`WindowedPlainParagraphBodySource` only for a plain P with one Text node and one
matching Paragraph AST. The structural parser must have consumed the horizontal
prefix, and a full-body literal source-unit proof must account for the body;
only whitespace may remain at its tail. `ActiveRegion.plainParagraphBody` is a
short-lived proof for that region's current source, shared by
`restoreMountedSourceSelection`, body selection and the existing generic merge.
The canonical prefix remains byte-exact during interior edits and history;
foreign source or row content does not inherit that proof.
The accepted Preview source and ordered block IDs seed mapped code intervals.
A fence created locally by a visual shortcut or toolbar command carries
runtime-only provenance for its exact `pre` node and canonical body interval
until a new Preview is accepted. Full transports each retained PRE's interval
through the actual authenticated canonical change descriptor, then validates
its fence, body, source revision and retained DOM order. Removing an earlier
block therefore does not relabel a surviving PRE by a stale ordinal. History
snapshots retain indexed correspondence and rebind it only to validated
rematerialized PREs; a missing identity, foreign reorder or unproved topology
change still fails before another block can be written. The interval inventory
is parsed once per commit and indexed by its parser-issued ordinal for both
fenced and indented leaves, without gaps for unsupported body kinds.
The transported closed-fence syntax excludes its trailing separator line ending.
Both overlap detection and byte reconstruction use the same half-open interval:
an adjacent deletion/replacement leaves it intact, while an actual overlap still
invalidates it and zero-width insertions retain their explicit root ownership.
Windowed navigation inside an operation-created PRE uses the current gap's
bounded code-body source range until formal Preview acceptance. It renews the
canonical selection, gap and restoration lease together without changing source,
revision, history or the Preview request; a replacement PRE receives that caret
even when navigation is followed by no text edit.
Pointerdown still invalidates the previous pending caret. A subsequent current
gesture may renew navigation inside that same physical source-bound operation
PRE through `reauthenticatePendingNavigationSelection`, but only with the
current signature, source and revision, full presentation and capability
proofs, protection checks and `projectVisualCodeBodySelection`. This preserves
the user's newly pointed body position after Redo rather than replaying the
pre-pointer caret; without that gesture the restored history position remains
authoritative.
Delegated Media insertion uses a separate selection-preparation capability so
that Media can preserve its insertion range without making transition flushes
depend on selection state.
For a signature-matched visual paste accepted at canonical offset `0` or
`source.length`, the paste transaction owns that known document-edge selection
and restores it at the first or last safe editable DOM boundary without running
the generic DOM search. Internal positions still use the bounded mapper and
fail explicitly when they cannot be mapped, except for a collapsed caret that
the source proves is on an editable fenced block's opening delimiter/info line:
that one is presented at the block's code-body start without changing the
accepted source, so a trusted native input then commits at the code body
instead of a stale paragraph offset.

`Ctrl/Cmd+A` is owned by the connected visual root in both non-windowed and
windowed immersive editing. The whole-root deletion owner handles only
`deleteContentBackward` and `deleteContentForward`; Cut, IME, partial
selections, and partial CODE selections remain with their existing protected
owners. In the windowed path, the current root range must cover every
non-spacer child with a valid range-ledger binding. That binding may identify a
generated or non-editable root when the whole canonical document is explicitly
selected. It never expands a partial mounted range to hidden source. Mapped
source separator ranges and terminal whitespace are handled only when the
accepted source-range map identifies them; unsupported or unmounted source
gaps fail explicitly. The connected-root coverage guard is limited to the
Backspace/Delete whole-document path, including its keydown handoff, so
ordinary typing retains the cached interval-map fast path without a
full-document scan.

When the accepted visual boundary hides a parser-recognized Markdown
`HeaderMark`, `ListMark`, or `QuoteMark` separator, the local Markdown parser
maps exactly one ASCII space or tab as the structural separator. Additional
separator or tail bytes remain source content; code-body separators do not use
this projection. The parser check runs only for that hidden boundary case, so
ordinary input keeps its existing fast path. An input that leaves a structural
body empty flushes through the existing pending-intent or visual-input merge
owner; it does not use the whole-document transaction below. That transaction is
otherwise reserved for Backspace/Delete over a connected full-root selection. It
also owns one narrow keydown path for Backspace: a focused, editable,
whitespace-only source with no pending input, an empty read-only snapshot, and
an accepted DOM ledger that still matches the current source clears to the empty
canonical source.

The whole-root deletion transaction resets the visual surface to one empty
paragraph with a BR and a connected caret in the same input turn before the
next native character can arrive; the full-root selection deletion clears the
canonical source. Outside that selection path, terminal ASCII spaces or newlines
may use the empty paragraph presentation while their source bytes remain intact,
and unlock or Read paths preserve those bytes. Insertion at the visual boundary
preserves the whitespace. The accepted-whitespace Backspace clear is the separate
explicit path that writes the empty source. For the whitespace-only keydown path,
the owner retains the original child nodes and native selection until the
canonical write succeeds. A synchronization failure before that write restores
those exact nodes and that selection; a failure after the write keeps the committed
empty source and reset presentation and is reported
instead of restoring stale DOM. Directly formatted list and
blockquote bodies use the same empty-Backspace presentation rule while
non-empty LI, P, PRE, and CODE content remains source-owned. An empty
structural body keeps its accepted local snapshot through immediate next input,
Undo, and Redo; equivalent protected generated regions retain their node
identity without a formal Preview request. The accepted render of an empty
document is the paper placeholder and carries no edit map, so an accepted empty
source adopts by resetting the same empty paragraph and placing its terminal
caret; a non-empty accepted source still requires its edit map and fails
explicitly without one. The installed paper placeholder is a presentation the
editor already certifies: a staging candidate keeps its `html`, old
`htmlRevision` and `paperPlaceholder` and does not install a pre-acceptance
first paint over it; the formal enhancement and commit still carry the new
value once accepted.
After the existing canonical, owned-DOM, read-only and protected-region checks,
pending input may equate collapsed native and target offsets 0 and 1 only on the
same `P`/`DIV` with exactly one `BR` child, without moving Selection or changing
DOM. Zero-child blocks and inline containers receive no such equivalence.
A collapsed element boundary in one retained direct root whose post-edit native
point is a `Text` directly inside that same root authenticates two independent
effects. A pure source insertion takes its caret from the existing
native-source projection rather than the merge splice's total length, so block
separator line endings in that splice do not displace it; a source replacement
keeps its inferred caret. The same witness, replacement included, uses the
existing canonical history-selection effect to record the explicit selection,
and no adapter or second history owner is added. Ordinary `Text` boundaries and
nested code do not match this witness.
Whitespace-only canonical source may receive one or more empty paragraphs from
native Enter while the canonical source remains a no-op. Full owns that shape
only when both canonical source and serialized visual surface are
whitespace-only, the surface has at least one root, and every root is an
attribute-free paragraph whose sole child is a `BR`. This empty-presentation
ledger writes no canonical byte and grants no map-mediated content authority.
Text, an ID or any other attribute, protected descendants, or non-whitespace
source retains the explicit `visual-editor-canonical-change-dom-stale`
rejection. The first Ctrl/Cmd+Z after the empty Enter uses formal CodeMirror
Undo and cannot reuse an older non-empty map certificate.

During a bounded window child replacement, the Safe HTML sink derives the
focused full-root Selection from the connected surface and preserves its
forward or backward direction synchronously after the replacement. It also
preserves a connected live text selection and root-boundary caret. Partial
root selections and full-root selections after focus leaves the surface are
never expanded to the new root; no caller-side shortcut flag grants that
authority.

Generated TOC, footnote, rendered math, and Mermaid regions remain the same
read-only DOM nodes while visual editing is active. Their child markup and
meaningful root attributes are compared exactly before serialization. An empty
root `style` attribute introduced or removed by responsive browser layout is
ignored because it has no declaration; non-empty style, content, attribute,
identity, count, or order changes still fail with the stable visual-editor
diagnostic. During a new accepted non-windowed Preview commit, the Safe HTML
sink preserves an existing protected node only at the same child-node path with
the same tag, namespace, attributes, and child markup. Changed or reordered
output uses the fresh server-authoritative node. The sink records the adopted
node sequence as its committed identity, so later reconciliation cannot replace
an equivalent protected subtree behind the visual editor's owner. Local visual
synchronization failures do not change the formal server Preview status or
reuse the Preview failure message.
Local visual-history snapshot restoration uses the same equivalence owner after
canonical history and snapshot validation. It matches protected regions by
their protected-region order, allowing restored editable siblings to shift DOM
paths without replacing unchanged renderer instances. Protected-region count,
tag, namespace, meaningful attributes, and child markup must still agree; a
mismatch keeps the fresh snapshot node. Blank root `style` remains the only
nonsemantic attribute normalization for both paths.

The Markdown feature detector and renderer share `MarkdownCodeRegionScanner`
so math delimiters inside fenced, indented, or inline code remain literal and
do not request the KaTeX path. The Preview surface also excludes math nodes
nested in code when annotating enhanced visual sources. This prevents syntax
highlighting from invalidating false math markers while CommonMark remains the
only production renderer.

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
table. The browser shortcut adapter receives the registry defaults as
provenance: a changed or cleared Settings binding consumes the displaced
default key inside the editor, including repeated keydown events, without
dispatching a command, while the configured binding remains the only command
owner. Composition and non-editor targets keep their existing browser behavior.

The Preview session debounces Reads, aborts superseded requests, rejects stale
revisions and Markdown signatures, and renders branded server-sanitized HTML
through one React Safe HTML sink. `easymde/v1/preview` and PHP
`MarkdownRenderer` remain the formal rendering authority. Focused TypeScript
Adapters enhance only a connected, inert staging candidate for the accepted
response with local Highlight.js, KaTeX, Mermaid, TOC, the selected Code Theme,
and the Mac code frame; the candidate is atomically handed to the single Safe
HTML sink only after enhancement. The sink applies either one safe HTML
revision or one staged-node revision and does not let React reconcile children.
The shared enhancement runtime yields between code, math, and diagram nodes and
checks its typed `isCurrent`/AbortSignal control between slices; Mermaid work
is serial, so stale candidates stop without starting the remaining diagrams.
An enhancement failure commits the original sanitized response and reports the
failure without inventing a renderer fallback.

The WordPress session Adapter observes Heartbeat authentication, REST Nonce,
Post Lock, capability, and connection state through `wp.hooks`. It blocks new
protected operations at the owning boundary while preserving unsaved content,
the Dirty baseline, Local Draft recovery, and the complete native form. Save,
Publish, Media, Custom CSS, and Revision operations report only authoritative
results and never retry protected mutations automatically. The separately
approved bounded Image Hosting primary- and backup-write contract is the only
current exception; Verify Upload remains single-attempt.

Local Draft recovery uses the versioned `easymde:draft:v1:<site>:<user>:<post-or-new>` identity, a 1 MiB limit, a 500-millisecond latest-write scheduler, explicit read/write/discard failures, and cross-tab conflict handling. New-post identity comes from the stable PHP Bootstrap contract rather than WordPress's temporary auto-draft ID.

WeChat export is user-initiated compatibility output from the current stable, sanitized, locally enhanced Preview. `createWechatExportSession` owns the ordinary and immersive surfaces, and `createBrowserWechatClipboard` owns the browser Clipboard adapter and its single clone-and-serialize pipeline; the data flow is Preview sink -> session -> adapter -> browser Clipboard path. When the formal Preview sink is under `display:none` (hidden by `easymde-preview-surface-hidden` during unlocked visual editing or by source-only modes), `wechat-payload-serializer.ts` mounts an off-screen, layout-participating clone of that formal Preview sink beside the nearest rendered ancestor—reading only container width (never ProseMirror DOM)—and disposes it in `finally`. Copy never writes Markdown, `post_content`, metadata, revisions, or publication state.

The strict-boolean `images.wechatPngExportEnabled` setting defaults to `false`,
and Editor bootstrap projects it as `wechatExport.pngConversionEnabled`. When
enabled, an explicit ordinary or immersive Copy uses the modern Clipboard
deferred payload path to serially rasterize only outermost rendered Mermaid and
KaTeX math roots, then uploads each PNG through the Editor's selected
`ImageUploadPort`. Image Hosting enabled selects the existing Image Hosting
owner; disabled selects the existing WordPress Media Library owner. Ordinary
tables, existing images, ordinary SVG, code, other media, and unknown content
retain portable HTML. Background preparation for ordinary Preview remains
compatibility-only and never runs from visual editing; explicit Copy prepares
the current stable surface on demand. Legacy Clipboard and synchronous modern
setup failure upload nothing. A failed selected owner never switches;
Copy publishes no partial Clipboard payload, though an upload completed before
a later transaction failure can remain. The live Preview and document remain
unchanged.
EditorRoot cancels a queued or active background demand when visual unlock
begins, Preview loses `ready` status, an ordinary or immersive Preview sink is
disposed or replaced, the Root tears down, or the WeChat Port/export ownership
changes. That signal belongs to the background demand and does not cancel an
explicit Copy. The browser Adapter tracks background waiters and one active job
per sink, checks cancellation before finalizing markup, deriving plain text, or
publishing prepared cache state, and leaves shared theme-image fetches
independent.

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
The load-hook document owner is limited to that exact authorized route; direct
no-route requests still redirect, unsupported routes still fail explicitly,
and every other WordPress admin screen retains its native document and assets.
The dedicated response does not create a new authentication or settings owner:
WordPress completes login and capability admission before the load hook and
continues to own Nonces, REST mutations, and persistence.

The supported General runtime settings are passed from `AdminAssets` through
the validated Editor Root bootstrap and consumed by the Editor Root's
document source, workspace layout, Preview feature overrides, focus behavior,
and local-draft session. The Settings Center auto-save switch and interval are
the only local-draft configuration for ordinary and immersive editing;
browser-session immersive preferences own presentation only. The browser
preference port persists only the immersive Outline choice. The Editor Root
maps Settings Center `general.editingMode` from `live-preview` to immersive
split, `source` to source, and `preview` to Preview when the Root mounts.
At narrow widths, the Outline overlays a full-width workspace. A completed
transition into editable immersive Preview, or a width crossing into narrow
layout while Preview is already editable, closes that overlay once as local
presentation state. Pending or failed unlocks do not close it; a manual reopen
at the same width remains open. These changes never write the Outline
preference.
The transition waits for the current visual-editor runtime surface to be
connected before moving focus or closing the Outline. While unlocking, the
control remains focusable and reports `aria-busy` and `aria-disabled`; only a
capability-unavailable control uses native `disabled`.
Changing the immersive mode is session-only: it survives exiting and re-entering
immersive writing while that Root remains mounted, but a normal or hard refresh
creates a new Root and restores the Settings Center mode. Legacy stored
`splitPreview` values are ignored without a read-time write and are omitted by
the next legitimate Outline preference write. Retired immersive auto-save values
are ignored without a read-time write and disappear on the next legitimate
immersive preference change. The bootstrap marks both `post-new.php` and nonzero
`auto-draft` contexts as new documents so the auto-focus preference cannot
focus an existing post.

## Editor Mode

EasyMDE editor mode is scoped to supported post types, `post` and `page` by default. The supported post type list can be filtered with `easymde_supported_post_types`.

`PostModeController` owns the editor-admission rule for admin editing: new and existing posts for supported post types use EasyMDE when the current user can create or edit that post. The `use_block_editor_for_post` filter, editor template rendering, and admin asset loading all call that same rule.

Editor admission does not depend on `_easymde_enabled`, `_easymde_markdown`, or other EasyMDE metadata. Unsupported post types keep the normal WordPress editor unless a site explicitly adds them through `easymde_supported_post_types`.

Opening an ordinary existing supported post imports the current `post_content` into Markdown in memory for the editor. It does not write metadata, rewrite content, create revisions, or migrate the post on open.

## Data Model

Markdown is the source of truth in `_easymde_markdown`. WordPress `post_content` stores rendered HTML for themes, feeds, search, plugins, visitors, and compatibility when EasyMDE is inactive.

Native Save and autosave render compatibility HTML through WordPress's
`wp_insert_post_data` slashed post-field contract; Core unslashes that field
before storage. The render signature hashes the raw HTML that Core stores.
Metadata writes for Save, autosave, revision copy, and revision restore apply
the same boundary rule to the exact Markdown source; reads remain ordinary
metadata reads.

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

Markdown image scale is represented by the reserved title suffix
`{width=25%}`, `{width=33%}`, `{width=50%}`, `{width=67%}`, `{width=100%}`,
`{width=150%}`, or `{width=200%}`. The marker is parsed and restored by the
formal PHP renderer and serialized by the shared visual/source contract; the
original alt text, destination, and non-marker title remain part of the same
image syntax. Unsupported, repeated, or malformed markers fail explicitly.
The renderer emits `data-easymde-image-scale` only for those validated values.
Shared `frontend/base.css`, loaded in both editor and public output, applies
the exact percentage up to 100%, and caps 150% and 200% at `max-width: 100%` so
rendered output is capped by containing content width with no horizontal overflow,
while preserving canonical scale markers. Unmarked images retain the theme's
responsive sizing. Percentage sizing is relative to the containing content box;
theme image borders remain decoration.

Rendering behavior:

- raw Markdown HTML is stripped, except the exact lowercase attribute-free `<br>` token inside a table cell, which the controlled table-break parser represents as a safe AST node and renders as `<br>`; no other raw HTML gains output permission;
- unsafe links are disabled by the CommonMark configuration;
- math placeholders are extracted and restored as EasyMDE math nodes;
- `TocGenerator` owns heading IDs and `[TOC]` replacement;
- `ThemeMarkupTransformer` owns article-theme-specific DOM transforms and MDNice container normalization;
- `VisualPreviewBlockAnnotator` (`src/Content/VisualPreviewBlockAnnotator.php`) carries CommonMark block provenance through Preview HTML transforms and emits the privacy-safe `editMap` sidecar, while `VisualPreviewCodeProjectionBuilder` (`src/Content/VisualPreviewCodeProjectionBuilder.php`) builds the source-backed fenced/indented code-body map and UTF-16 tab-expanded code cursor projection from the same parsed CommonMark AST (exposed through `VisualPreviewBlockAnnotator` without rendering Markdown or owning persistence);
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

Settings reads and writes require `manage_options`; updates are sanitized and persisted with the existing editor-settings option, including the 19 toolbar shortcut mappings, the explicit `imageHostingEnabled` owner choice (default `false`), the strict-boolean `wechatPngExportEnabled` preference (default `false`), local pasted-image automatic-upload preference, and four-state remote-image paste preference. A missing stored PNG preference reads as `false` without a write. The Settings Center bootstrap schema is `4`; Transfer export schema is `12`. Transfer imports `1` through `11` receive the explicit legacy image-rule and four-format conversion, while schema `12` requires the canonical fields. The current development defaults are a 30-second autosave interval, no automatic retry after a failed provider write, no Markdown image title, `storagePath` `{year}/{month}`, suffix-free basename `fileNameRule` `{md5}`, and all six ordered upload formats enabled: `webp`, `png`, `jpg`, `jpeg`, `jfif`, `gif`. The new `remoteImageUploadMode` contract has no legacy parser, migration, compatibility alias, or schema-version branch. A POST requires the action-specific settings Nonce, a body no larger than 64 KiB, and the complete exact-key settings contract with the current nonnegative `revision`. Missing, extra, conflicting, or invalid fields are rejected, stale revisions return `easymde_settings_conflict` with HTTP 409, and an option-write failure returns `easymde_settings_persistence_failed` with HTTP 500. A legacy write payload that omits `storagePath` or uses the old four-key format map is accepted only through the same deterministic conversion used for legacy Reads; a canonical payload must carry both split fields and exactly six boolean format keys with at least one enabled. The option write uses a byte-exact compare-and-swap predicate so concurrent saves cannot silently clobber each other; an unchanged current submission is a successful no-op and does not increment the revision. Settings bootstrap, ordinary settings responses, transfer exports, logs, and diagnostics do not expose image-provider credentials. The optional top-level `resetSecrets: true` flag is the explicit destructive path that clears all four image-provider credentials; ordinary blank secret fields retain stored credentials. A password-field eye action is a separate explicit disclosure: `/image-hosting/secret` accepts an exact primary/backup target and Access Key/Secret Key field, returns only that saved value with `Cache-Control: no-store`, and leaves it only in current React component memory. It is never persisted, copied into browser Storage, or loaded implicitly.

Preview Markdown payloads are capped at 1 MiB. The persisted
`imageHostingEnabled` setting is the explicit owner choice for local image-file
paste and drop, and defaults to `false`. The
`autoUploadPastedImages` setting defaults to enabled and controls whether a
pasted local image with one of the six supported suffixes (`.webp`, `.png`,
`.jpg`, `.jpeg`, `.jfif`, or `.gif`) is uploaded in both the ordinary source
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
PHP validates the current capability, action Nonce, real MIME, lowercased source
extension, its exact enabled format, byte size, and optional post authority
before it reads server-only credentials or contacts a provider. JPG, JPEG, and
JFIF are separate admission choices even when their verified MIME is
`image/jpeg`.

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
The imported path verifies the real GIF, JPEG, PNG, or WebP MIME and the
configured size and format limits before passing the temporary file to the
existing Image Hosting runtime, and every exit removes that temporary file.
An extensionless remote image receives the documented MIME-derived compatible
suffix; a supplied suffix that mismatches the verified MIME or is disabled by
the exact format map fails explicitly rather than being relabeled.
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

The native upload prefilter converts the repository's known configuration
error into an explicit WordPress upload error. It does not rewrite invalid
settings or continue the upload; unexpected exceptions remain visible.

The canonical image settings split the object key into `images.storagePath`,
the suffix-free basename stem `images.fileNameRule`, and the exact
`images.uploadFormats` map. Their defaults are `{year}/{month}`, `{md5}`, and
the ordered entries `webp`, `png`, `jpg`, `jpeg`, `jfif`, `gif` all enabled.
The six common naming presets retain their established directory/name
combinations without `.{ext}`. Selecting one atomically updates both fields;
selection state compares the complete pair rather than the basename alone.
An explicit empty `storagePath` means the bucket or WordPress upload root; it
is distinct from a missing legacy field. When the stored document has no
`storagePath`, `SettingsCenterRepository` derives it by splitting the old
complete `fileNameRule` at its last `/`, then removes exactly one terminal
`.{ext}` from the basename. A legacy `{ext}` in a directory, in the middle,
repeated, or leaving an empty stem is an explicit configuration/import error;
it is not normalized by fallback. This read-time projection does not write or
advance the settings revision. A legitimate Save establishes both fields, and
an already-open legacy write payload is normalized through the same conversion.
The legacy four-key map expands `jpg` to independent `jpg`, `jpeg`, and `jfif`
entries. Settings Center bootstrap schema 4 and Transfer schema 12 are
canonical; schemas 1 through 11 receive this explicit conversion and schema 12
is strict.

`Plugin` constructs one `ImageHosting\ObjectKeyBuilder` and injects it into
both runtimes. The builder combines, validates, and expands the path and
suffix-free stem once; it is the only key-expansion owner for the Image Hosting
provider and future EasyMDE local paste/drop uploads through
`/easymde/v1/media`, including when Image Hosting is disabled. It appends
exactly one lowercased, verified source extension after checking the real MIME
and that extension's enabled checkbox. Canonical templates, presets, exports,
and persisted settings never contain `{ext}`. Combined validation retains the
historical 160-byte and object-key safety rules. UTC time, UUID, `post_id`, MD5,
date/time, and sanitized name are expanded only after the real bytes and MIME
are validated. Original sanitized names remain separate from the generated
storage key and drive default alt text, response filename/title, and the
attachment title stem.

The Media controller reads one credential-free
`storage_path`/`file_name_rule`/`allowed_extensions`/`max_bytes`/`mime_types`/
`title_display` snapshot, validates the real MIME, exact source extension,
enabled format, and declared size, reads bounded exact bytes, and passes both
canonical fields to the shared builder. A key, extension, or scope failure is
explicit and never falls back to the ordinary upload path. A scoped
`jfif => image/jpeg` MIME allowance is installed only for the owned JFIF
operation and removed with all other hooks in `finally`; WordPress's global MIME
policy is unchanged.

`MediaUploadPathScope` adds a one-time internal token to the exact temporary
file. Its final-priority `wp_handle_sideload_prefilter` restores only the
generated basename. The matching final `wp_handle_sideload_overrides` callback
registers an exact-file final `wp_check_filetype_and_ext` callback; only that
final MIME boundary arms the one-shot `upload_dir` projection, so directory
reads from earlier overrides or MIME callbacks remain ordinary. `finally`
removes the prefilter, overrides, MIME, and upload-directory callbacks. The
projection uses the filtered `basedir`, `baseurl`, and `error`, replaces the
path/URL/subdirectory with the rule directory without appending WordPress's
date folders, and never falls back to the ordinary upload directory. WordPress
Core remains authoritative for MIME handling, `wp_unique_filename()`, the
attachment, metadata, sub-sizes, URL, permissions, and native media picker
behavior. A successful Core attachment is rejected and deleted if its scope
was not consumed.

This is a future-upload path only: historical attachments are not migrated,
and the explicit native media-picker insertion path is unchanged.

`EasyMDE\ImageHosting\ImageHostingRuntime` owns remote image preparation,
object-key construction, provider selection, and backup orchestration.
Cloudflare R2, Qiniu Kodo, Alibaba Cloud OSS, and Tencent Cloud COS are supported
symmetrically: any one may be the primary or the optional backup. Primary and
backup writes use one generated object key as a fixed runtime invariant, not a
configurable setting. R2 uses the administrator-saved, validated HTTPS S3 API
endpoint; Kodo resolves the bucket's official upload domains through one bounded
HTTPS region query over the WordPress HTTP transport, validates every returned
`up*`/`upload*`.qiniup.com host, and bounds the ordered host list to four entries.
Source `up*` hosts are ordered before `upload*` hosts because they are the official
SDK source-upload origins. The runtime supplies the current bounded destination
attempt index to the provider; each attempt selects one validated host and performs
exactly one SDK-compatible form write. It supplies that host to an explicit SDK
`Region`/`Config` with HTTPS enabled and CDN domains disabled. The pinned Qiniu
SDK form uploader bypasses its middleware option, so EasyMDE builds only the
SDK-compatible form request and routes it through a narrow middleware bridge;
the SDK cURL handler and its region/back-up retries are never used. Host selection
across explicit destination retry attempts is internal to the selected Qiniu
destination, not a new setting or provider switch. OSS and COS derive their
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
match. The runtime generates the plugin-owned EasyMDE PNG object key by passing
the current `storagePath` and basename `fileNameRule` to the shared
`ObjectKeyBuilder`, with the current UTC clock and UUID owner and
`post_id = 0`, then uploads only to the selected target. Rules containing time
or UUID variables may create a new object on each verification. Success returns
`status: uploaded`, the object path, and the
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
algorithm. The builder uses the verified lowercased source extension only after
the exact MIME-family and enabled-format checks, then appends it once. The
default `storagePath` is `{year}/{month}`, the default suffix-free basename
`fileNameRule` is `{md5}`, and the default `titleDisplay` is `none`, so
generated Markdown image syntax has no title unless the administrator
explicitly changes that setting. The Settings Center preview alone appends the
first enabled extension; with defaults it displays
`2026/07/a8f4c2d1.webp`. Changing either split field or the enabled-format map
invalidates a pending or completed verification fingerprint.

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
