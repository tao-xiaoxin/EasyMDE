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

The ordinary Editor startup stylesheet transaction is coordinated by
`frontend/src/entrypoints/admin-editor.tsx` via
`frontend/src/entrypoints/admin-editor-stylesheets.ts`
(`prepareInitialEditorStylesheets`, `scopeBaseEditorStylesheet`, and
`disposeStylesheetLeases`). It waits for the base content
stylesheet and the selected article-theme stylesheet through
`createEditorStylesheetReadiness`; a changed article theme remains an inactive
candidate until it is readable and scoped. The preparation lease moves through
`pending`, `provisional`, `committed`, and `closed` phases. It transfers the
canonical ID and media before the React Root and Appearance ports are
constructed, and removes the old link only after the mount succeeds. Cancel,
load/error failure, teardown, and mount failure remove candidates, dispose
leases, and restore the old link before `onStartupFailure` reports the stable
failure code. Alongside `admin-editor-stylesheets.ts`, `admin-editor.tsx`
delegates DOM field discovery, native WordPress bridges, and browser adapter
helpers to `frontend/src/entrypoints/admin-editor-browser-adapters.ts`, and
lazy WeChat clipboard/rasterizer port loading, cold-copy freshness guarding,
and prestarted modern clipboard write handoff to
`frontend/src/entrypoints/admin-editor-lazy-wechat-ports.ts`.

`createWordPressAppearancePort` owns the runtime appearance transaction after
startup. It scopes article and Custom CSS styles through
`frontend/src/shared/css/editor-stylesheet-scope.ts`, publishes the four native
appearance bridge fields and its in-memory snapshot only after stylesheet
preparation and DOM handoff, and rolls back fields, snapshot, nodes, and leases
on failure. An unchanged Custom CSS node and text with its tracked lease are
reused; changed Custom CSS uses an inactive candidate. If restoration cannot
verify its stylesheet lease, the port marks its state unverified and rejects
later appearance applications until the owner is refreshed.

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
|   |   |   |-- css/                     # Editor stylesheet scoping and CSS selector-list helpers.
|   |   |   |-- dom/                     # Protected visual-node DOM adoption and attribute helpers.
|   |   |   |-- keyboard/                # Shared keyboard and shortcut utilities.
|   |   |   |-- markdown/                # Shared Markdown line-model and math TeX normalization helpers.
|   |   |   |-- mermaid/                 # Single cross-bundle Mermaid runtime initialization and intrinsic layout owner (`mermaid-runtime-config.ts`).
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

`frontend/src/entrypoints/admin-editor-loader.ts` is the PHP-enqueued production loader for the ordinary Editor. `AdminAssets` validates `assets/build/admin-editor-loader/wordpress-manifest.json` and `assets/build/wordpress-manifest.json`, enqueues the stable `easymde-admin-editor-toolbar` loader handle, emits `<link rel="modulepreload">` hints for the main entry, and serializes the versioned loader Bootstrap with `mainScriptUrl` and `moduleFormat: "esm"`. The loader reads and same-origin-validates `mainScriptUrl`, dynamically loads the hashed local ES Module entry (`frontend/src/entrypoints/admin-editor.tsx`, compiled with Vite `format: "es"`, target `es2020`, reusing the WordPress 6.7 React 18 `wp.element` global via `wordpressEsmExternals()`), and starts the same React Editor Root after its DOM gate is ready. Heavy on-demand capabilities—specifically the unified ProseMirror + `markdown-it` immersive visual editor (`frontend/src/features/immersive-visual/MountedProseMirrorVisualEditor.tsx`), the WeChat Clipboard serializer/rasterizer (`frontend/src/integrations/browser/wechat/`), and secondary CodeMirror indentation language packs—are dynamically code-split into local chunks loaded only when activated. The Editor manifest also owns exactly one local `assets/wechat-png-encoder-[hash].js` resource for explicit PNG conversion; release validation requires that worker resource alongside the entry, dynamic chunks, and `.asset.php` metadata. `templates/admin/editor-shell.php` provides one empty `#easymde-editor-root` mount and native WordPress submission fields. The Markdown field remains visible until CodeMirror owns a working document session; React then hides both that bridge field and `#postdivrich`, restoring them on teardown or failure; there is no parallel Legacy editor container.

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

The `frontend/src/entrypoints/admin-editor.tsx` entrypoint parses external data
before mounting, delegates startup stylesheet transactions to
`frontend/src/entrypoints/admin-editor-stylesheets.ts`, DOM field discovery,
native Save/Publish/Revision bridges, clipboard and PNG-encoder runtime helpers,
and simplified formatting parsing to
`frontend/src/entrypoints/admin-editor-browser-adapters.ts`, and lazy WeChat
clipboard/rasterizer port loading, cold-copy freshness guarding, and prestarted
modern clipboard write handoff to
`frontend/src/entrypoints/admin-editor-lazy-wechat-ports.ts`, constructs focused
WordPress and browser Adapters (reading cached Preview widths directly from
`frontend/src/integrations/browser/wechat/wechat-preview-width-store.ts` so the
WeChat export chunk remains dynamically code-split), mounts one modular
`EditorRoot` (`frontend/src/app/editor/EditorRoot.tsx` composed from focused
feature-bridge hooks and `ImmersiveVisualEditorHost.tsx`), and owns idempotent
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
  the dependency direction strictly one-way from serializer to preservation, and
  memoizing serialized strings per immutable `ProseMirrorNode` in a `WeakMap`
  so untouched pasted or newly created blocks are not re-serialized on every
  keystroke).
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
  hover/focus Edit quick action, double-click editing,
  `Ctrl/Cmd+Enter` commit, and non-propagating `Escape` cancel), renders Mac
  3-dot code frames with incremental `Decoration.inline` Highlight.js tokens
  (scoped to changed document ranges via `nodesBetween`),
  supports interactive task-list checkboxes that preserve original list markers,
  and provides click-to-select image blue rings and 7-value width scaling
  (`{width=25%..200%}`). `visual-boundary-commands.ts` owns atom/container
  boundary keybindings (`Backspace`/`Delete`/`Mod-Home`/`Mod-End`/edge-arrow
  guards) and the Chromium atomic-selection anchor widget plugin.
- **Canonical synchronization, IME & source indexing**: `visual-canonical-sync.ts`
  is the single authoritative bridge between the ProseMirror projection and
  `EditorDocumentSession` (CodeMirror + native form bridge), handling bounded
  text diffs, contiguous typing history grouping, echo suppression, and
  incremental canonical Undo/Redo reconciliation. While mounted,
  `ProseMirrorVisualEditor` activates `documentSession.document.setVisualEditingActive(true)`
  (and restores `false` on unmount or startup error) so hidden CodeMirror parks
  its DOM and disables live Lezer Markdown syntax re-parsing during visual
  editing while remaining the sole canonical state and history owner. `visual-composition-session.ts`
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
  `frontend/src/integrations/browser/wechat/wechat-preview-measurement.ts`
  (backed by `frontend/src/integrations/browser/wechat/wechat-preview-width-store.ts`)
  mounts a temporary off-screen layout-participating clone of the formal Preview
  sink (reading only container width, never ProseMirror DOM) and removes it in
  `finally`, while
  `frontend/src/integrations/browser/wechat/wechat-portable-serialization.ts`
  serializes the measured clone.
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

The ProseMirror visual adapter returns a target lease
(`VisualEditorContextMenuTargetLease` via `captureContextMenuTarget` in
`visual-context-menu-adapter.ts`) bound to the original live DOM `Element`
inside `view.dom` and the captured canonical document revision
(`documentSession.document.getRevision()`). `resolve()` returns that original
element only while the runtime is alive, the element remains connected inside
`view.dom`, and the canonical revision has not changed; if the element
disconnects or the document revision advances, `resolve()` returns `null`.
Null retires the demand silently: there is no fallback to a disconnected
element, no lookup by ordinal block id, no coordinate re-test, and no menu for
a different block. Every terminal path - dismissal, action close, cancellation,
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

Empty-table context-menu commands work directly from ProseMirror's live table
node and cell selection through the `EditorContextMenuTargetLease` and
`visual-source-index.ts` source-range mapping, without depending on nonempty
cell text nodes or a retired DOM-only `currentEmptyTableTarget` helper.

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
publication can never be preserved by it. Source publishes no such transition
and simply omits the member.

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
the ProseMirror document and canonical Markdown untouched. The owner keeps
that shadow bound to its box through the
image and surface geometry observers, the surface structure observer, and
scroll/resize, so a late resource load, a rewritten size attribute, a ProseMirror
block re-render, another target, menu focus, lock/exit, drift, and disposal all
rebind or clear it. The shadow is clamped to the preview's visible band, the
viewport narrowed by the surface's clipping ancestors: while the image sits
inside the band the shadow is exactly the image's box, the part that scrolled out
of the pane is never drawn, and a fully scrolled-out image is hidden instead of
painting over the toolbar, the header, another pane, or outside the viewport.

Pointer activation of a thematic break is distinct from keyboard Context Menu
activation. In the unified visual editor, a thematic break is a
`horizontal_rule` atom node in `visual-schema.ts`, rendered as a non-editable
rule. Pointer and context-menu targets resolve through
`visual-context-menu-target-resolution.ts` to the exact node; a deliberate mixed
or straddling text range keeps generic text commands, and keyboard activation
never retargets from its anchor. A rule `NodeSelection` maps to its exact raw
source line through `visual-source-mapping.ts`. Delete and Backspace next to a
rule or protected card are handled by `visual-boundary-commands.ts`: a caret or
gap cursor beside the atom first selects it, a selected atom is removed in one
transaction, and an empty paragraph beside it is removed without joining
neighboring blocks. Every such edit is one ProseMirror transaction synchronized
to canonical Markdown by `visual-canonical-sync.ts`, sharing the editor's single
Undo/Redo history, while untouched blocks keep their original marker spelling,
whitespace, and line endings. Source-mode insertion above a rule keeps two line
endings so a following paragraph cannot become a Setext heading.

Code blocks are `code_block` nodes rendered by `node-views/code-block-node-view.ts`
inside the shared Mac frame. Leaving or collapsing a code block uses ordinary
ProseMirror commands from `visual-commands.ts` and `visual-boundary-commands.ts`
rather than DOM gap certificates: `Mod-Enter` (`exitCode`) continues in a new
paragraph after the block, Delete at the end of a code block moves the caret to
the start of the next block instead of joining it (and is a no-op at document
end), Backspace in an empty code block converts it to a paragraph, and Backspace
at the start of a block that follows a non-empty code block or table moves the
caret into that block without selecting, deleting, or joining it. `Tab` and
`Shift+Tab` indent and outdent code lines. A collapsed position between blocks
is a `prosemirror-gapcursor` selection; typing there creates a new paragraph
that serializes as its own Markdown block while neighboring blocks keep their
raw source bytes through block preservation. `visual-source-mapping.ts` and
`visual-source-index.ts` own the mapping between ProseMirror positions and
canonical Markdown selections, and `visual-composition-session.ts` keeps
canonical synchronization from interrupting an active IME composition.

Structural edits across headings, paragraphs, lists, blockquotes, inline
protected atoms, and GFM tables (including cell Tab navigation, outer-edge
atomic boundaries, and preserving untouched raw Markdown spellings) are owned
directly by the unified ProseMirror schema, `visual-boundary-commands.ts`,
`visual-table-operations.ts`, `markdown-block-preservation.ts`, and
`visual-canonical-sync.ts` (see `Unified ProseMirror Immersive Visual Editor`
above), replacing the retired `contentEditable` Full/Windowed DOM-projection
helpers.

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

A formal PHP Preview response is enhanced in an inert staging element
(`preview-enhancement-staging.ts`) carrying the active Preview's theme and
width context — connected offscreen for normal documents so layout-dependent
enhancements can measure, and detached (`display: none`) for large documents
above `PREVIEW_LARGE_DOCUMENT_BLOCK_THRESHOLD` (160 blocks) to avoid layout
thrash — then handed to `SafePreviewHtmlSink` (`PreviewSurfaceOwner`) as one
revisioned staged commit. React keeps the accepted enhanced state while
`SafePreviewHtmlSink` remains the sole imperative child owner: on each new
staged commit it validates unique child nodes and installs the staged children
atomically (`surface.replaceChildren(...commit.nodes)`), and on same-commit
rerenders it verifies exact child identity (`hasExactChildren`) so a rerender
cannot roll the committed subtree back. The previously accepted enhanced
subtree remains visible while a replacement Preview request or local
enhancement pass is pending.

Preview scroll snapshots belong to their request generation. Ratio-based
restoration runs after that generation's accepted DOM commit reaches ready;
loading and enhancement do not consume it, and failure, supersession, or
teardown discards the snapshot. A ratio is never captured while a commit is
still committing or enhancing.

Layout-dependent Mac code-frame variables are synchronized in one batched
read-then-write pass (`syncCodeFrameBackgrounds`) against the active surface:
Pass 1 reads computed `backgroundColor` and `color` from every code element
(`pre > code.hljs, pre.easymde-code-block > code`) before Pass 2 writes
`--easymde-code-frame-background`, `--easymde-code-line-number-color`, and the
visual `.easymde-visual-code-lang` badge foreground color. During live code
theme switches while unlocked, `ProseMirrorVisualEditor` applies updated theme
classes in `useLayoutEffect` before `use-editor-appearance-bridge.ts` runs its
`useLayoutEffect` frame sync, so existing code blocks update both frame
background and badge foreground without remounting.

While unlocked in immersive Preview, `ProseMirrorVisualEditor` owns all visual
editing, `Ctrl/Cmd+A`, boundary Backspace/Delete, paste, and empty-document
states in memory and synchronizes edits through `visual-canonical-sync.ts` and
`EditorDocumentSession` (CodeMirror), parking CodeMirror's DOM/syntax parser
via `setVisualEditingActive(true/false)` while mounted. On canonical Undo/Redo
or external reconciliation, `visual-canonical-sync.ts` (`reconcile`) applies
CodeMirror's canonical Markdown and mapped selection directly to the live
ProseMirror document and rebinds the `markdown-block-preservation.ts` guard to
`reconciledDoc` (and to `nextState.doc` on whole-document resets) so surviving
blocks and list items retain object identity and untouched raw Markdown bytes
without per-keystroke formal Preview requests, window spacers, 160-block caps,
DOM-snapshot history slots, or PRE-rematerialization ledgers. Delegated Media
insertion uses a separate selection-preparation capability so Media preserves
its insertion range without coupling transition flushes to selection state.
Local visual synchronization failures never overwrite formal server Preview
status or reuse the Preview failure message, and locking back to read-only
Preview (`leaveVisualPreview`) synchronizes canonical Markdown and reconciles
against the formal Preview sink.

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

WeChat export is user-initiated compatibility output from the current stable, sanitized, locally enhanced Preview. `createWechatExportSession` owns the ordinary and immersive surfaces, and `createBrowserWechatClipboard` owns the browser Clipboard adapter and its single clone-and-serialize pipeline; the data flow is Preview sink -> session -> adapter -> browser Clipboard path. When the formal Preview sink is under `display:none` (hidden by `easymde-preview-surface-hidden` during unlocked ProseMirror visual editing or by source-only modes), `wechat-preview-measurement.ts` mounts an off-screen, layout-participating clone of that formal Preview sink with its ancestor chain—reading only container width (from the visible ProseMirror surface or remembered width, never ProseMirror DOM)—and disposes it on transaction cleanup. Copy never writes Markdown, `post_content`, metadata, revisions, or publication state. The session coalesces one active operation, signals cancellation and sequence-invalidates it during disposal or replacement, and suppresses late status. `EditorRoot` projects that operation to both ordinary and immersive controls, which share one pending state and clear it only after the session returns the browser owner's result.
Under `frontend/src/integrations/browser/wechat/`, both adapters stay
composition owners: `create-browser-wechat-clipboard.ts` owns the public
`WechatClipboardPort` factory and shared caches while delegating copy
orchestration to `wechat-clipboard-copy-transaction.ts` (modern deferred-Blob
browser commit, timeouts, and Preview readiness resolution),
`wechat-clipboard-copy-portable.ts` (portable Copy transactions),
`wechat-clipboard-copy-png.ts` (PNG-conversion Copy transactions), and
`wechat-clipboard-copy-legacy.ts` (the activation-sensitive synchronous legacy
`execCommand` driver and synchronous modern-failure fallback), while
`create-browser-wechat-visual-rasterizer.ts` keeps SVG assembly (delegating
direct-SVG backdrop synthesis, `preserveAspectRatio` viewport mapping, and
opacity/radius routing to `wechat-mermaid-direct-svg-backdrop.ts`), decode,
encode (with `create-browser-wechat-png-encoder.ts`,
`wechat-png-encoder-protocol.ts`, and `wechat-png-encoder.worker.ts`), and its
factory. The browser-facing responsibilities live in modular private families
beside them:

- clone metadata (`wechat-clone-metadata.ts`), lightweight shared copy
  preconditions (`wechat-copy-preconditions.ts`, shared with
  `admin-editor-lazy-wechat-ports.ts`, `wechat-source-freshness.ts`, and
  `create-browser-wechat-clipboard.ts`), and source freshness
  (`wechat-source-freshness.ts`);
- style policy (`wechat-style-policy.ts`, `wechat-style-policy-catalog.ts`,
  `wechat-style-policy-content-box.ts`, `wechat-style-policy-semantics.ts`) and
  portable declaration emission (`wechat-style-declarations.ts`);
- background theme images (`wechat-background-images.ts`), pseudo-elements and
  quote/heading pseudo-flow (`wechat-pseudo-content.ts`,
  `wechat-pseudo-elements.ts`, `wechat-heading-pseudo-flow.ts`,
  `wechat-quote-pseudo-flow.ts`), and the inline pseudo-paint pipeline
  (`wechat-inline-pseudo-paint.ts` over `wechat-inline-pseudo-paint-types.ts`,
  `wechat-inline-pseudo-paint-core.ts`,
  `wechat-inline-pseudo-paint-admission.ts`,
  `wechat-inline-pseudo-paint-source.ts`,
  `wechat-inline-pseudo-paint-plan.ts`, `wechat-inline-pseudo-paint-bind.ts`,
  and `wechat-inline-pseudo-paint-apply.ts`);
- portable content and media (`wechat-portable-content.ts`,
  `wechat-portable-media.ts`) and portable serialization
  (`wechat-portable-serialization.ts` composed with
  `wechat-portable-serialization-inline-styles.ts`,
  `wechat-portable-serialization-math.ts`,
  `wechat-portable-serialization-pseudo-paint.ts`,
  `wechat-portable-serialization-finalize.ts`, and
  `wechat-portable-serialization-plaintext.ts`);
- prepared-payload lifecycle (`wechat-prepared-payload.ts` composed with
  `wechat-prepared-payload-state.ts`, `wechat-prepared-payload-builder.ts`, and
  `wechat-prepared-payload-background.ts`);
- preview measurement and geometry caching (`wechat-preview-measurement.ts`,
  `wechat-preview-geometry-cache.ts`, and the lightweight
  `wechat-preview-width-store.ts`), dimension semantics
  (`wechat-dimension-semantics.ts`), and fidelity signatures
  (`wechat-fidelity-signature.ts`);
- task caption, checkbox style, layout policy, geometry, paint, list
  projection, and static flow (`wechat-task-caption.ts`,
  `wechat-task-checkbox-style.ts`, `wechat-task-layout-policy.ts`,
  `wechat-task-geometry.ts`, `wechat-task-paint.ts`,
  `wechat-task-list-projection.ts`, `wechat-task-static-flow.ts`,
  `wechat-task-static-flow-policy.ts`,
  `wechat-task-static-flow-projection.ts`), nested lists and native table grids
  (`wechat-list-table-layout.ts`, `wechat-nested-list-projection.ts`,
  `wechat-table-native-grid.ts`, `wechat-table-native-grid-integration.ts`), and
  SVG markers (`wechat-svg-marker-geometry.ts`,
  `wechat-svg-marker-projection.ts`, `wechat-svg-portable-integration.ts`);
- math static-flow (`wechat-math-static-flow.ts` composed with
  `wechat-math-static-flow-model.ts`, `wechat-math-static-flow-admission.ts`,
  and `wechat-math-static-flow-capture.ts`) and atlas-backed math vector
  capture, portable binding, and scene materialization
  (`wechat-math-vector-capture.ts` composed with
  `wechat-math-vector-capture-primitives.ts`,
  `wechat-math-vector-capture-fonts.ts`,
  `wechat-math-vector-capture-graphics.ts`, and
  `wechat-math-vector-capture-layout.ts`, alongside
  `wechat-math-vector-portable.ts` and `wechat-math-vector-scene.ts`);
- Mermaid geometry, background resolution, CSS color compositing, direct-SVG
  backdrop synthesis, content-box, policy, capture plans, and PNG conversion
  (`wechat-mermaid-geometry.ts`, `wechat-css-color.ts`,
  `wechat-mermaid-background.ts`, `wechat-mermaid-direct-svg-backdrop.ts`,
  `wechat-mermaid-content-box.ts`, `wechat-mermaid-policy.ts`,
  `wechat-capture-plan.ts`, `wechat-png-conversion-policy.ts`,
  `wechat-png-conversion.ts`, `wechat-png-replacement.ts`,
  `wechat-rasterizer-mermaid.ts`), managed fonts (`wechat-managed-fonts.ts`,
  `wechat-font-assets.ts`), math capture geometry
  (`wechat-math-capture-geometry.ts`), CSS scanning (`wechat-css-list.ts`,
  `wechat-css-property-reader.ts`), and runtime/UserTiming helpers
  (`wechat-clipboard-runtime.ts`, `wechat-copy-timing.ts`, `wechat-timing.ts`).

Their focused Vitest suites are partitioned the same way.
Native table-grid admission and application preserve the existing scroll owner
while correcting only the final table display. Table inputs also participate in
prepared fidelity checks and the existing transaction's final Source guard;
connected measurement cleanup remains transaction-owned, including cancellation
after Blob delivery while the native write is pending. The executable boundary
belongs to the [WeChat export reference](../.agents/skills/easymde/references/wechat-export.md#layout-and-special-content).
Block-vector installation preserves a responsive decorated math scroll owner,
with intrinsic normal-flow content and measured vertical allocation; it does not
freeze the source column width or depend on native Save retaining absolute SVG
positioning. The complete allocation contract belongs to the
[WeChat export reference](../.agents/skills/easymde/references/wechat-export.md).
Ordinary transform origins use the raw dimension context when the CSSOM value
is a validated center, axis-keyword, percentage, or pixel semantic; unsupported
raw grammar keeps the measured value. The asynchronous and synchronous
serializers share this style-policy owner, and the transportable raw semantic is
included in ordinary fidelity freshness signatures.

While Copy is pending, both ordinary and immersive controls remain focusable and expose `aria-busy="true"` and `aria-disabled="true"` instead of native `disabled`; the shared pending reference rejects duplicate click and keyboard activation. The static WeChat glyph preserves control geometry while Copy is pending. Native `disabled` remains reserved for an unavailable capability.
An article-theme, code-theme, or Custom CSS change owns cancellation of an active Copy. The session returns `status: cancelled` with `wechat-copy-cancelled`, emits an info diagnostic for the intentional cancellation, and emits no success or failure status. A real Adapter failure or residual upload remains an explicit diagnostic and side-effect result. The appearance change refreshes Preview only; it never starts Copy automatically, so a new theme requires a new explicit Copy. During style loading, both controls remain focusable with `aria-disabled="true"` and without `aria-busy`.
Unexpected synchronous throws and asynchronous rejections from the Clipboard
adapter become the fixed privacy-safe `wechat-copy-unexpected-error` diagnostic;
raw errors never cross the session boundary. A late unexpected result after
session disposal records that cause before
`wechat-export-completed-after-teardown`, but publishes no late UI status. A
typed late result keeps only the teardown diagnostic.
Generated textual pseudos are materialized only while their computed paint is
visible. A hidden text pseudo does not become Clipboard content merely because
its `content` value remains non-empty; modern and legacy Clipboard paths share
this rule. Visible theme decoration and CSS-only carriers retain their existing
serialization behavior.
Static inline circle and mask pseudo paint is captured during the existing
async or synchronous XHTML style walk, with its already computed owner style
and clone identity. Hidden/rasterized roots and later Source omissions are
excluded. After final math, SVG, PNG, and structure transforms, one admitted
inventory resolves final owners through the canonical generated-marker and
structure replacement maps, then performs one atomic detached apply. Missing
or duplicate markers fail explicitly, and the apply owner preserves anchor
attributes, original child identities, plaintext, and rollback. The actual
measurement/transition readiness owner and original Source freshness owner are
threaded through preparation; full CSSOM fidelity signatures guard Blob and
post-write boundaries in addition to DOM freshness.
For an ordinary native `outside` list whose Source has zero logical-start
padding, the Clipboard adapter measures the browser's native marker advance in
a temporary shallow probe and writes that measured gutter on the copied list.
This keeps markers inside destination clipping boundaries without replacing
`OL`/`UL`/`LI`, changing numbering attributes, or converting to `inside`.
Lists with an existing gutter and task/custom/mixed-direction owners remain
unchanged; unavailable geometry fails explicitly and every probe is removed.
The serializer marks generated pseudo and text owners rather than inferring
them from sanitized attributes. When a proven visible static inline textual
`LI::before` directly precedes one generated raw-text leaf, that leaf omits the
internal `leaf` marker and remains inline so WeChat cannot promote the text to
a block independently from its marker. Ambiguous and special owners retain the
ordinary leaf path.
Task-marker SVG path syntax is parsed by the exact locked `svg-pathdata`
dependency in the Clipboard adapter. This parser does not render Markdown,
authorize SVG markup, or prove visible paint; namespace/element/attribute
validation, finite resource bounds and native pixel validation are separate.
Version 7.2.0 retains the Node 20 toolchain baseline as a local build-time source
for the admin adapter, with its MIT notice. The Clipboard owner updates this pin when
the Node baseline changes and removes it if task SVG path parsing is removed.
Task checkbox owners and their emitted pseudo layers keep the settled Preview
allocation after WeChat strips inline positioning. The private
`wechat-task-static-flow.ts` owner holds the normalization sequence and the
terminal validation, `wechat-task-static-flow-projection.ts` holds the
containing-block traversal, measurement and per-layer allocation records, and
`wechat-task-static-flow-policy.ts` holds the pure CSS and geometry policy.
Portable serialization imports the normalizers and invokes the root-level
allocation assertion after the paint assertion, so the paint module does not
depend back on the static-flow owner. The serializer replaces the projected
position, inset, margin, and float declarations of every emitted layer with a
static float allocation whose
margins reproduce the captured layer box and leave a zero net advance, so list
rows and captions keep their Preview spacing.
The allocation reads measured layout values only, namely the untransformed border
box projected into the declarations plus the layer offsets and containing block
plane, so a retained paint transform applies exactly once and no transformed
viewport rectangle is used. Anchoring is physical left, so the emitted allocation
never embeds the captured source container width or direction; how a destination
reflows the emitted float allocation is not measured by the Clipboard capture.
Owners and their layout inputs come from the registered clone owners of the
emitted caption owner inventory rather than a root-wide discovery query, so a
recorded owner the serializer never projected stays with the terminal owner
validation, an emitted absolute layer is converted regardless of current
opacity, a projected layer whose marker is missing fails explicitly, a recorded
owner outside the serialized root fails instead of writing elsewhere, and
predecessor boxes without a derivable prospective float origin fail instead of
guessing a line position. That origin, and every consumed chain box offset, is
anchored at the container content edge, so a prior float that still participates
in float placement fails explicitly at either slot, including logical float
values, while the normalized zero-net layers this owner already emitted stay
ignorable. Static insets
stay inert while fixed, sticky, and active relative positioning fail explicitly.
Containers where float is inert, such as flex and grid items, and active effects
the portable emission cannot preserve are rejected. The asynchronous entry
checks abort and conversion currentness around every owner and suspends only
between owners on the caller's existing serialization budget, while the legacy
synchronous entry shares the same per-owner core without suspension. The terminal
owner assertion re-derives every recorded allocation from the final declarations
so a later overwrite cannot silently deform the row. Native WeChat Paste, Save,
and Reader acceptance remains required destination evidence and is not
established by this capture-side contract.
For ordinary tables, Source paint metadata may project an opaque solid THEAD
background onto transparent TH cells. Source-owned rounded tables with
separate zero-spacing borders and two-axis clipping retain those table values;
the generated outer section continues to own horizontal scrolling and width.
These rules never hard-code a theme color or radius.

The strict-boolean `images.wechatPngExportEnabled` setting defaults to `false`,
and Editor bootstrap projects it as `wechatExport.pngConversionEnabled`. The
same Bootstrap supplies the required `wechatMathAtlasUrl` and
`wechatMathAtlasContentVersion`; the URL carries exactly the matching lowercase
16-hex content version in its `contentversion` query and resolves beneath the
validated `previewEnhancement.assetBaseUrl` to the exact
`assets/math/easymde-katex-glyph-atlas.json` runtime path. PHP derives that
version from the atlas file's SHA-256. The atlas is one manifest-owned generated
`easymde-katex-glyph-atlas/1` asset derived from the complete locked KaTeX TTF
inventory; its companion font notice is shipped in the installable ZIP.

With PNG conversion disabled, the default portable serializer uses this atlas
for eligible outermost KaTeX owners. Eligibility accepts `inline-block` and
`inline-flex` math plus `block` or `flow-root` owners with the recognized KaTeX
block role and neutral authored outer width. Nested owners stay with the
outermost owner; true `display:inline` math, non-KaTeX math, and a Preview with
no eligible owner stay on the existing portable path without an atlas request.
The lower-level legacy compatibility path also keeps that portable path when
both atlas fields are absent; production Bootstrap requires the pair. The browser validates
the exact same-origin URL/version pair, fetches only for an eligible owner,
limits the response to 8 MiB, validates the complete frozen glyph graph, and
reuses it only for that exact URL/version. Cancellation or a stale owner does
not publish a cache entry.

Atlas-backed capture uses the current hidden measurement lease and requires
paired source, measurement, and final clone identities plus identical source
and measurement text. It records managed KaTeX text runs, rule and static SVG
paint, and the direct visual viewport, then builds detached SVG scenes from
atlas outlines. Only the proven paired KaTeX `vlist-s` strut is omitted.
Unsupported visible paint, unresolved clips or matrices, missing or ambiguous
managed faces, unknown glyphs, invalid paths, incomplete pairing, and text
mismatch fail explicitly. The final serialized root records connected plain
text before scenes replace the visible math tree, so Clipboard `text/plain`
retains the formula text. All targets and scenes are validated before mutation;
a failed installation restores each target's children and style and propagates
the failure. The source Preview remains unchanged.

Vector geometry separates neutral flow allocation `A`, the measured owner
border-box `R`, and the direct visual union `V`. For atomic inline math, `A` is
the fractional parent line-box allocation including vertical margins; an outer
wrapper owns that allocation, while `R` preserves the styled target's
background, border, and padding exactly once. Block math uses `R` as the block
target directly and has no inline `A`. `V` supplies the scene viewBox and paint
translation. Internal solid `colorbox`/`fcolorbox` background and border paint
is emitted once as measured scene rectangles; outer shell paint remains on the
sanitized HTML owner and is not duplicated into the generated scene.
Unsupported visible owner paint, missing or non-finite geometry, and
out-of-bounds or inconsistent allocation/viewport data fail explicitly. The
measurement lease and capture probes are released once on success, failure,
abort, stale, timeout, and teardown.

PNG-enabled Copy bypasses atlas loading, glyph runs, SVG vector scenes, and
vector materialization. It uses the modern Clipboard deferred payload path to
serially rasterize only outermost rendered Mermaid and KaTeX math roots in
stable source order, then uploads each PNG through the Editor's selected
`ImageUploadPort` with backpressure and at most three in-flight uploads.
Completion is retained by candidate order and visual clones are replaced only
after all selected-owner uploads succeed, in that order.
Each upload invocation tracks whether it was rejected before write, remains
unknown, or completed. Only the exact whitelisted
`easymde_rest_invalid_image_hosting_nonce` permission rejection proves no write
for that invocation. Unknown service codes, arbitrary 403s, network/provider/
Abort/response failures, completed writes, and mixed concurrent states preserve
the `uploads-may-remain` side effect; one proven pre-write rejection never clears
another invocation's possible residual write.
Image Hosting enabled selects the existing Image Hosting owner; disabled selects
the existing WordPress Media Library owner. Ordinary tables, existing images,
ordinary SVG, code, other media, and unknown content retain portable HTML.
Background preparation for ordinary Preview remains compatibility-only and
never runs from visual editing; explicit Copy prepares the current stable
surface on demand. With PNG conversion enabled, EditorRoot schedules only a
hidden-Preview geometry-only lease through the existing resize/layout owner;
it skips portable serialization, rasterization, and upload. An explicit Copy
transfers one matching pending lease and cleans it on every terminal path, so
measurement DOM never persists across Copy operations. The disabled/default
path prepares the portable payload, including the hidden measurement, atlas
load/validation, and local SVG-path scene materialization for eligible outermost
KaTeX owners. It never rasterizes or uploads in the background. A vector cache
entry is published only after complete validation; cancel, stale, HTTP, decode,
graph, capture, scene, or installation failure rejects that preparation without
a silent portable-only substitution or partial success. The source Preview
remains unchanged.
The shared Mermaid runtime gives Gantt diagrams a deterministic 1200px logical
layout width while retaining responsive `useMaxWidth` display. This prevents a
narrow Preview host from changing task and date geometry. PNG Copy may recover
a downscaled Mermaid SVG's intrinsic viewport scale only from a connected
auto-height owner whose direct SVG fills the owner's content box and uses
untransformed default `xMidYMid meet` geometry. That compensation path leaves fixed height, animation,
clipping, transforms, non-filling SVGs, borders, padding, and other aspect modes
retain captured geometry. Compensated output keeps overflow local and height
automatic.
For a neutral normal-flow Mermaid root with one capped, responsive direct SVG,
the separate `responsive-viewport` capture mode omits the editor row's external
transparent space. It captures the styled SVG clone while retaining the SVG
scene and viewBox padding. The output retains the serialized outer-root layout;
only its generated image receives percentage width, the original SVG cap,
automatic height and verified centering. It adds no width-check exemption.
Capture choice and effective dimension/centering semantics are frozen before
asynchronous cloning, checked after cloning and at final freshness using
root-relative geometry. Unknown effective dimension semantics decline this
mode. Its PNG width rounds upward at the selected DPR; height rounds from that
integer width and the captured SVG aspect. Actual output edges and pixel limits
remain validated. The full eligibility and lifecycle contract belongs to the
WeChat export reference.
Legacy Clipboard and synchronous modern setup failure upload nothing. A failed
selected owner never switches; stale or aborted conversion aborts remaining
uploads and rejects the deferred payload. Copy publishes no
partial Clipboard payload, though an upload completed before a later
transaction failure can remain. The live Preview and document remain unchanged.
The PNG conversion branch still prepares computed root metadata, removes class
and transient attributes, and registers the outer visual root before inserting
the native image into the converted output. It therefore skips descendant,
pseudo-element, and theme-background portable serialization for the converted
candidate while native capture reads the current source tree; portable,
background, legacy, table, and ordinary-SVG serialization remains unchanged.
After drawing that capture, an injected PNG encoding Port transfers its
ImageBitmap to a temporary local worker for OffscreenCanvas PNG encoding.
Capability selection occurs before encoding; runtime worker failure is
terminal. Encoding remains serial and preserves the existing rasterization
geometry, digest and limits. The executable capability, strict-message,
bitmap-ownership, abort and timeout contract is owned by
`.agents/skills/easymde/references/wechat-export.md`.
When the resolved Safe Preview is hidden or source mode is active, the
Clipboard adapter obtains one ephemeral measurement lease for the current
enhanced Preview and reuses it for portable HTML/plain-text serialization and
PNG visual-root capture, including original parent typography. The original
Safe Preview remains the source, prepared-cache key, and freshness owner.
`EditorRoot` keeps `preview`/`split` presentation separate from source mode;
ordinary entry is `split`, and source-mode entry records the last visible width.
The lease retains the Preview presentation marker and class context, paper
geometry, canvas media-query presentation, and full Preview wrapping while
neutralizing hidden ancestor layout at the measured workspace width. It is not
a cached measurement DOM; transfer into the active preparation and cleanup
cover every success, failure, abort, stale, timeout, and teardown path.
Cloned images settle through load/decode or explicit failure before any
freshness fingerprint, including warm-cache reuse, or payload commit. Lazy
clones are temporarily eager and restore their loading attributes; readiness
stays within the existing per-resource and transaction bounds without resetting
the transaction clock. Abort cancels immediately, late events cannot publish
or cache work, and cleanup is terminal.
Hidden readiness attaches clone image listeners before the temporary host is
attached; after attachment it forces one layout on the measurement root and
reads the current owner's `document.fonts.ready`. Initial, current, and final
freshness fingerprints and payload work wait for that font readiness and every
clone image load/decode. An absent or already-loaded FontFaceSet with no clone
images and no active eligible finite CSS effects retains the synchronous
legacy-ready path. The lease does not listen to
document-wide `loadingerror`; managed font fetch/parse failures remain owned by
the visual rasterizer. Abort, cleanup, and late font resolution are terminal.
The existing 10-second resource deadline, 60-second transaction, 8ms
serialization yield budget, and write-first activation remain unchanged.
Initial readiness includes finite native CSS transitions and animations owned
by Preview and its attached measurement tree before style, geometry, and cache
snapshots. JavaScript and infinite effects are excluded. Pending, running, or paused finite effects
share the fonts/images resource deadline, which clears on successful readiness.
API and `finished` failures remain latched for that lease; synchronous cache and
legacy paths cannot bypass them. Final gates reject changed finite CSS effects as stale
without another readiness wait or source rebaseline. Source animations remain
untouched, and settled uploads retain the transaction deadline.
Dimension semantics use a bounded raw clone-context batch separate from the
serialization tree. Visible layout geometry remains measured from the original
source; hidden/source layout reuses the measurement tree with raw source
semantics. The ordinary preservation path has a bounded seven-field raw tuple:
`box-sizing` plus `width`, `min-width`, `max-width`, `height`, `min-height`, and
`max-height`. It applies only to same-namespace normal-flow elements with
`display:block`, `position:static|relative`, `float:none`, a non-replaced
element, and raw `box-sizing:content-box`; every dimension is a finite
non-negative `px` or `%` token or its property-specific `auto`/`none` keyword,
and at least one percentage has positive padding-plus-border edges on its
axis. Root and pseudo-elements, replaced elements, descendants whose raw
formatting owner (including through `display:contents`) is flex/grid/table,
elements under `svg`, `math`, `pre`, `code`, or `table`, visual-rasterization
and KaTeX/Mermaid owners or descendants, and generated clones are excluded.
Eligible tuples preserve the six raw dimensions and `box-sizing`; only
`box-sizing` and `max-width` receive `!important` in this dimension path to
survive native rules. Ordinary content-box values outside this tuple keep the
existing projection behavior: finite pixels add CSSOM padding and border widths
for border-box output, while percentage and `calc()` values retain the CSSOM
projection path. SVG, math, PNG, pseudo-element, and other special geometry
stays atomic; ordinary images retain semantic width growth and `height:auto`.
Raw `box-sizing` and dimensions participate in initial, current, final, and
warm freshness signatures, so equal used geometry does not hide a raw semantic
change. Raw/measurement/serialization contexts clean up temporary display,
attributes, and clones in `finally`.
The batch uses at most two deep clones, with the raw context and serialization
tree kept separate. Temporary geometry and raw semantic trees exclude runtime
sink, acceptance, refresh, error, and editor-owner identity markers on creation
and refresh; the original Preview remains their only owner.
Raw CSSOM auto and finite percentage margins remain responsive on ordinary elements, eligible
static/relative pseudos, and outermost ordinary/Mermaid SVG roots. Other
computed geometry, fixed margins, absolute pseudos, internal SVG, and math
remain unchanged. Raw margin semantics join every freshness/cache phase, and
the raw snapshot refreshes before guarded serialization/signature reads.
Async serialization uses the existing budget for conditional task checkpoints
after HTML capture and connected plain-text measurement. Abort and PNG
currentness checks bracket each actual yield; final source/semantic guards and
the synchronous legacy path remain intact. This splits layout work without
changing HTML or deriving text through another renderer.
The exporter-owned portable root projection adds only `max-width:100%` and
`margin:0 auto` after computed Preview styles. This root-level declaration step
is separate from hidden-surface measurement, whose lease retains the original
paper geometry. Root styles use the current root-export property mask, including
root background, layout, and pseudo-element styles. Visible serialization reads
the marked temporary raw context clone, whose marker lasts only for the
controlled temporary-host lifetime. Hidden measurement briefly sets
`data-easymde-wechat-export-style-context` on the measurement clone while taking
the root snapshot and restores it in `finally`; the original Safe Preview root
is never marked. Neither temporary context is persisted on the live Preview or
payload, and root-projected styles participate in the prepared freshness
signature. The live Preview and article content remain unchanged and no fixed
MDNice
spacing value is encoded.

For the portable path, a successful modern setup constructs deferred HTML and
plain text Blob payloads and invokes the browser `write()` owner in the
originating click task before yielding or reading computed styles and geometry.
After that write starts, a pending entry's `sourceMarkup` is compared with the
current full key before it is awaited; an obsolete entry is ignored locally and
the existing fresh-preparation path runs without cache deletion or catch-all
retry. For portable modern Copy, the non-windowed source-freshness guard is
captured after the native `write()` starts and before the first browser-task
yield, while a windowed baseline waits for `resolvePreview` to complete
legitimate materialization. An older same-source background promise may trigger
one fresh preparation only for the two narrow internal recoverable errors:
`wechat-copy-stale` and an `AbortError` whose message is
`wechat-background-preparation-cancelled`. Before recovery, the
activation-source, session, and signal guards must remain current; a
current/user abort or stale owner propagates cancellation and does not retry.
All other failures propagate unless a completed same-source fallback was
recovered. The stale/cancelled path performs one fresh preparation, preserves
completed same-source fallback reuse, does not retry other failures, and
never starts a second native write. All terminal
paths clean up freshness state; this transaction-local guard adds no global
activation layout lock and changes no limits.
The later freshness walk includes the complete sink markup, root attributes
except the three refresh bookkeeping attributes, viewport, computed export and
pseudo-element styles, and element dimensions; scroll-coordinate-only changes
may reuse a payload. Ordinary and pseudo-element logical text alignment is
converted to physical values using source direction. The bounded raw tuple is
the only ordinary percentage-preservation exception; outside it, ordinary
`content-box` finite pixel dimensions are projected to border-box by adding
padding and borders, while percentage and `calc()` values retain the existing
CSSOM projection path. Intrinsic values and special SVG/Math/KaTeX/Mermaid
geometry remain unchanged. Raw `box-sizing` remains in the semantic freshness
signature. The legacy `execCommand` path retains its synchronous
activation requirement and consumes only a source- and layout-fresh prepared
payload. A non-emitted pseudo-element (`pseudoContent(rawContent) === null`)
contributes only its raw `content` sentinel to freshness and skips unused
pseudo-style reads, serialization, and asset fetch; quoted empty and text
pseudos retain full styles and existing limits. Ordinary-node, source, and
geometry handling is unchanged.
For generated H1-H4 `::after` decorations whose parsed content is empty,
space-only, tab-only, or non-breaking-space-only, with visible normal-flow
placement, positive emitted dimensions, and retained paint, the paired
sync/async serializer marks the generated span and converts its generated
whitespace Text to one U+2060 glyph after normalization. Retained paint is
emitted background paint or at least one border edge with a visible color and
positive emitted width; zero-alpha transparent edges supply geometry only,
while nonzero-alpha colors count as visible paint. The existing root-scoped
Text map restores the original whitespace content during connected plaintext
measurement and restores encoded HTML in `finally`. Root, special-layout,
textual, hidden, absolute/fixed/sticky, zero-size, invisible-paint, and
unexportable pseudos are excluded; only heading-after visibility extends the
pseudo freshness signature.
The canonical `pseudoContent()` boundary decodes CSSOM quoted strings with CSS
character escapes before generated-whitespace qualification: up to six
hexadecimal digits plus one following CSS whitespace code point form one code
point (`\9 ` and `\000009 ` both become U+0009, while `\a ` becomes a newline).
Escaped quotes and literal backslashes keep their CSS string meaning, so
newline, authored text, and literal `\\9 ` content remain textual.
Portable output retains safe computed inherited typography defaults on
each node and pseudo-element for `font-style`, `font-variant`, `font-stretch`,
`letter-spacing`, `text-transform`, `white-space`, `text-indent`, `text-shadow`,
`tab-size`, and `list-style-position`, while omitting layout defaults. Anchors
retain their computed `text-decoration`, including `none`, rather than
inheriting a destination platform default. For this portable text rule,
`overflow-wrap` preserves its computed source value with
`!important` so it outranks WeChat's global `word-wrap:break-word!important`
alias; the serializer does not blanket-apply `!important` or hardcode platform
values, and native PNG capture is unchanged. Fenced-code hash boundaries use
root-scoped Text records to prevent destination topic links from overriding
syntax colors; the shared HTML/plaintext rules are owned by the
[WeChat export reference](../.agents/skills/easymde/references/wechat-export.md).
Each transaction-local source
guard observes the sink before taking
its immutable initial canonical key and drains `MutationObserver.takeRecords()`
at initial, current, and final checkpoints. Each currentness check scans
recognized task inputs' current `checked` properties, since a property
change need not emit a DOM mutation. The clean path reuses the initial
source key without rebuilding full markup only when that state is
unchanged and no meaningful mutation is pending; otherwise the guard
recomputes and compares the complete key, allowing same-value mutations to
reuse while making real source changes stale. Final source and layout keys and
the existing owner/layout guards remain authoritative. Only the three
refresh-bookkeeping attributes on the sink root are ignored; matching
descendant attributes remain source changes. Abort, timeout, stale, and
teardown gates reject deferred work, and `finally` disconnects the observer,
including late cleanup.
Portable structure normalization maps copied article, div, and blockquote roots
to sections only after safe computed styles and pseudo-elements are captured;
blockquote borders, backgrounds, spacing, nested children, and plain-text order
remain observable in the copied result while the source Preview is unchanged.
The quote pseudo-flow owner plans from immutable source snapshots and projects
admitted decorations into static floats with a separate padding carrier;
admission and lifecycle requirements belong to the WeChat export reference.
The portable serializer also owns one bounded ordinary nested-list projection:
admitted nested unordered `ul`/`li` clones become `section[role=list]` and
`section[role=listitem]` while outer list structure, attributes, child identity,
and plain-text order remain intact. Structural admission does not depend on an
optional stem; the separate stem paint projection uses source-relative
first/last child edges and is skipped when its closed geometry contract is not
proved. Tasks, ordered lists, counters, custom marker semantics, and mixed
unsupported trees retain their existing owners.
After the HTML string is captured, browser layout measures plain text from the
exclusive detached serialization tree. Non-layout DOM environments retain the
existing line-aware source-text fallback when connected text flattens block
boundaries; the temporary host is removed in `finally`. Source tables
retain authored/computed `min-width`, while only their generated scroll wrapper
uses `min-width:0`; source and table RGBA colors remain computed-source values
with no platform or theme hardcoding.

The visual rasterizer waits for document font readiness and resolves managed
font roots from the approved `previewEnhancement.assetBaseUrl` and approved
KaTeX stylesheet URL supplied by bootstrap. It embeds only matching managed
same-origin EasyMDE `@font-face` sources in the raster SVG; remote or
unrecognized URLs are omitted. For each matching face, the first approved
source in existing CSS order is the only source downloaded and natively
validated, while all retained weight, style, stretch, unicode-range, and other
face descriptors remain attached to their separate faces; failure of that
selected source fails conversion explicitly without an alternate-source retry
or fallback substitution. A required managed family with no source face,
invalid or rejected bytes, or failed browser-font validation fails explicitly;
only nonmanaged or system families may remain on the browser fallback. Bounded
font work is cancellable. Each successful PNG filename includes the SHA-256
digest of its final bytes, which preserves repeated output names while
distinguishing different output bytes.

Math rasterization first receives a native computed-style clone of the same Safe
Preview source and its original parent context for inline line-box typography.
The snapshot retains all safe computed dimensions and normal defaults, including
KaTeX, table, and pstrut geometry; computed `table-layout` remains native and
there is no authored-dimension preference rule. Inline allocation is
measured before capture normalization as fractional `inlineLayout` data
containing width, height, baseline, paint offsets, and optional viewport
geometry. The outer inline-block wrapper always owns the source allocation and
line box. Its inner original source-root viewport owns `auto`/`scroll`/
`hidden`/`clip` independently per axis; `autoX`/`hiddenY` expands X while
clipping Y, and `hiddenX`/`autoY` does the inverse. The PNG uses root-local
union paint offsets plus viewport offsets. Physical left margin is owned by the outer wrapper once and subtracted
once from the local paint offset; vertical margin remains allocation-only, and
source `vertical-align:top` and `bottom` retain their neighboring line-box
keywords while other modes use the measured allocation `B-H` relation. Paint
placement uses root-local union and viewport offsets rather than a fixed offset.
Capture
bounds retain full scroll/descendant extent
when appropriate and floor minima/ceil maxima once on the paint grid to remove
fractional phase drift. Missing or invalid allocation fails explicitly.
Display math retains a centered intrinsic wrapper with local horizontal overflow
and a block image; source padding, borders, backgrounds, and capture geometry
are baked into the PNG once. All output dimensions remain subject to the
existing 4096-edge and PNG-pixel bounds. Ordinary media keeps its responsive
sizing.
PNG natural pixel dimensions use the captured CSS dimensions multiplied by the
clamped device pixel ratio, while the pasted image keeps the captured CSS width
and height for display. Responsive destination rules therefore do not replace
the measured generated-image geometry.

The existing table, block-math, and direct-code normalizers declare intentional
local horizontal overflow through destination width-check metadata after
untrusted source attributes are removed. Article roots, PRE/header, and
ordinary content receive no exemption. Geometry, image dimensions, and plain
text remain unchanged; the executable boundaries and native negative-case
verification are owned by the WeChat export reference.

Modern Clipboard preparation has a 60-second bound for the serialized payload
and deferred HTML/plain Blob values; once they are ready, the actual browser
commit has a separate 10-second bound. Early browser-write rejection fails fast,
while late payload, stale-source, abort, and teardown gates prevent a deferred
value from reporting success after the operation is no longer current.

Focused unit coverage does not replace the native CSS allocation matrix. Native
production verification is the evidence boundary for fractional and
superscript source-to-PNG geometry; residual 1/64 CSS-pixel precision and DPR1
text anti-aliasing differences are rendering limits, not exporter offsets.

Preview request diagnostics use the current request session and the active
owner's latest callback reference. Known failures expose only the stable,
privacy-safe `preview-response-invalid` or `preview-request-failed` codes;
superseded, aborted, stale, or torn-down work does not publish a diagnostic or
error state. The owner is not recreated merely because the callback identity
changes. PHP owns strict source provenance, type, order, and range bounds; the
connected-overlap union is flushed once into readonly zero-width map entries.
The same editable map is enforced by both visual surfaces through the existing
marker/repository paths.
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
browser-session immersive preferences own presentation only. The browser preference port persists only the immersive Outline choice.
Settings Center `general.editingMode` applies only to Immersive Editing: the
Editor Root maps `live-preview` to immersive split, `source` to immersive
source, and `preview` to immersive Preview when the Root mounts, while the
ordinary editor always keeps its fixed side-by-side split workspace across all
viewport widths. Both ordinary and immersive split layouts remain side-by-side
across all viewport widths with the immersive split divider preserved
(single-pane presentation occurs only when the user selects Source-only or
Preview-only inside Immersive Editing). The docked Outline resizer and split
divider share one per-document pointer-drag owner; the first handle keeps the
drag until release, cancellation, capture loss, or teardown. Release is
idempotent per drag session; a stale callback cannot alter a later drag or
restore its cursor and selection styles. At tablet-portrait
widths (`<= 782px`, matching WordPress Core's admin breakpoint and covering
iPad mini portrait `744 × 1133`), the Outline overlays the full-width workspace. A
completed transition into editable immersive Preview, or a width crossing into
`<= 782px` while Preview is already editable, closes that overlay once as local
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
Shared `assets/css/frontend/base.css`, loaded in both editor and public output, applies
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

`frontend/src/features/live-preview/ui/SafePreviewHtmlSink.tsx` is the sole
client sink for accepted Preview HTML. It applies plain HTML and staged-node
commits while preserving the prior verified surface snapshot.
`PreviewSurfaceOwner` reacquires rendered SVG stylesheet scope synchronously
after each DOM mutation and releases the previous lease only after the
replacement lease is ready. A mutation failure restores the prior verified view
when possible; an unverified rollback clears the sink, discards pending
enhancement and staged-commit state, and reports the primary and rollback
failures without publishing `ready`.

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

The browser CSSOM owner is
`frontend/src/shared/css/editor-stylesheet-scope.ts`. It leaves source rules in
place and adds root-scoped aliases under `#easymde-editor-root`, preserving
selector order and supported nested rule, at-rule, and imported-sheet context.
It validates a whole batch before insertion, returns a reference-counted lease,
and removes only the rules owned by that lease. Missing sheets/imports,
CSSOM-read failures, invalid selectors, and root-scope conflicts fail
explicitly. Startup, Appearance, Preview enhancement, and rendered SVG style
handling use this owner; its scoping behavior does not replace the server-side
Custom CSS policy.

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
endpoint; Kodo uses
one direct multipart POST per destination attempt to the fixed
`https://upload.qiniup.com` origin, without an SDK, region query, or internal
host rotation. OSS and COS derive their
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
