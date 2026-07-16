---
name: easymde
description: Use this skill when building, modifying, debugging, reviewing, or validating EasyMDE React and TypeScript admin-editor features or related browser-side interfaces, including WordPress integration, Markdown editing and preview, publishing, revisions, media, themes, custom CSS, local state, testing, Vite builds, and release packaging.
---

# EasyMDE React Development Guide
EasyMDE is a standalone WordPress Markdown editor. React and TypeScript, built with Vite, are the browser-application architecture for the admin editor and related interactive interfaces.

Before writing custom code, check whether EasyMDE already has a domain rule, WordPress service, REST endpoint, registry, compatibility API, or reusable UI capability for the task. Extend the owning capability instead of creating a parallel path.

The root `AGENTS.md` remains authoritative. Follow it whenever it is stricter or more specific.
## Inspect Before Changing
Read the live repository before choosing files or abstractions:

```text
AGENTS.md
docs/ARCHITECTURE.md
src/Admin/
src/Content/
src/Theme/
src/Rest/
src/Frontend/
src/Support/
templates/admin/
assets/js/admin/
assets/css/admin/
scripts/build-release.mjs
tests/
```

Do not assume every path in this guide already exists. Create a directory or file only when the current feature needs it.

Trace the complete path:

```text
PHP bootstrap or WordPress state
→ typed browser contract
→ React store and feature
→ focused runtime port
→ WordPress, REST, or browser adapter
→ real save, publish, render, media, or revision result
```
## Critical Authority Rules
- `_easymde_markdown` is the canonical Markdown source.
- `post_content` is sanitized rendered HTML for WordPress compatibility.
- `EasyMDE\Content\MarkdownRenderer`, backed by `league/commonmark`, is the only production Markdown renderer.
- PHP and WordPress own permissions, nonces, post meta, revisions, media, taxonomies, save, publish, post status, and supported-post admission.
- React owns presentation, interaction state, feature composition, dialogs, panels, layout, and explicitly defined browser-session behavior.
- Opening, closing, previewing, focusing, or cancelling UI must not create hidden writes.
- Cancellation is a zero-write result unless the product contract explicitly says otherwise.
- Missing required capabilities, controls, assets, or bootstrap data must fail clearly.
- React must not create another data authority, renderer, permission system, save path, publish path, media store, or revision model.
- Preserve these public compatibility APIs:

```php
EasyMDE_Plugin::register_toolbar_button();
EasyMDE_Plugin::register_shortcode_helper();
```
## Repository Layout
Keep one root npm package. React and TypeScript source belongs under `frontend/`; browser runtime output belongs under `assets/build/`.

```text
EasyMDE/
├── src/                 # PHP production code
├── includes/            # compatibility and bootstrap files
├── templates/           # PHP-rendered templates
├── frontend/            # React and TypeScript source
├── assets/              # shipped runtime assets and generated browser output
├── scripts/             # build, packaging, i18n, notices, validation
├── tests/               # PHP, Node, and browser tests
├── docs/
├── package.json         # the single npm package
└── package-lock.json
```

Use this React source structure:

```text
frontend/src/
├── entrypoints/
├── app/
├── contracts/
├── domain/
├── features/
├── integrations/
├── shared/
└── test/
```

Responsibilities:

- `entrypoints/`: parse bootstrap data, create runtime and store, mount roots, report fatal startup failures.
- `app/`: shell, providers, error boundaries, store construction, top-level composition, application-wide styles.
- `contracts/`: typed bootstrap schemas, ports, request/result types, runtime interfaces.
- `domain/`: pure document, Markdown, outline, statistics, appearance, publishing, and revision rules.
- `features/`: complete user-facing capabilities grouped by feature.
- `integrations/`: WordPress DOM, REST, preview enhancement, storage, clipboard, and browser adapters.
- `shared/`: reusable UI, hooks, icons, utilities, and generic types without WordPress or feature ownership.
- `test/`: shared test setup, factories, fixtures, and helpers.

Do not create a generic catch-all `components/` directory at the application root.
## Feature Ownership
Group code by the capability the user recognizes:

```text
workspace
title-editor
markdown-editor
live-preview
outline
toolbar
appearance
custom-css
publishing
revisions
media
local-drafts
wechat-export
ai-assistant
```

Create only the feature directories required by current work. Use only subdirectories that contain real code.

A feature may expose an intentional public API through `index.ts`. It may import `domain`, `contracts`, and `shared`, but must not import another feature's private files.

Promote code to `shared` only after it has a stable, genuinely shared responsibility.
## Runtime Ports
React features depend on focused capabilities, not WordPress globals or DOM selectors.

```ts
export interface EditorRuntime {
  document: DocumentPort;
  preview: PreviewPort;
  appearance: AppearancePort;
  publishing: PublishingPort;
  revisions: RevisionPort;
  media: MediaPort;
  storage: StoragePort;
  clipboard: ClipboardPort;
}
```

Representative contracts:

```ts
export interface PreviewPort {
  render(
    input: PreviewRequest,
    options: { signal: AbortSignal; requestId: number },
  ): Promise<PreviewResult>;
}

export interface PublishingPort {
  readDraft(): Promise<PublishDraft>;
  preflight(draft: PublishDraft): Promise<PublishPreflight>;
  commit(draft: PublishDraft): Promise<PublishResult>;
}
```

Keep ports small and cohesive. Add a method to the capability that owns it; do not grow a universal `EditorAdapter`.

Only `entrypoints/` and `integrations/wordpress/` may know:

```text
window.EasyMDEConfig
window.wp.apiFetch
jQuery
WordPress native field selectors
native save and publish button selectors
wp.media
```

React components, domain modules, and feature models must not access those details directly.

Put behaviorally important browser APIs such as storage, clipboard, observers, and media queries behind focused adapters when they require failure handling or tests.
## Typed Bootstrap
Parse browser bootstrap data once in the entrypoint. Do not spread global configuration reads through the component tree.

Use a versioned contract:

```ts
export interface EditorBootstrap {
  version: 1;
  post: { id: number; type: string };
  document: DocumentSnapshot;
  appearance: AppearanceSnapshot;
  capabilities: EditorCapabilities;
  endpoints: EditorEndpoints;
  strings: EditorStrings;
}
```

Validate required fields before mounting. A missing endpoint, nonce, capability, translation, or document field is a startup error, not a reason to substitute `{}` or invent a default.

Pass typed data through providers, store initialization, and runtime construction. Components must not read `window.EasyMDEConfig`.

Capability hints may control presentation, but PHP and WordPress must verify every protected operation.
## State Ownership
Use one application store under `app/store/` for state shared by multiple features. Prefer selector-based subscriptions so Markdown typing does not rerender unrelated UI.

Recommended slices:

```text
document    # Markdown, title, saved baseline, document UI state
appearance  # article theme, code theme, fonts, custom CSS
layout      # view mode, pane ratio, outline, open panels
session     # pending work, errors, active surface, capabilities
```

Rules:

- Keep temporary dialog input local until confirmation.
- Keep persisted authority in PHP and WordPress.
- Treat native form fields as submission bridges, not a business-state store.
- Compute derived values with selectors or pure functions.
- Do not store the same fact in component state, context, the global store, and DOM fields.
- Do not use `useEffect` merely to mirror one React state value into another.
- Persist only explicitly approved preferences.
- Never place article content, publishing state, credentials, or private AI input in layout storage.
- Handle unavailable storage, access exceptions, corrupted values, and quota failures.

Document flow:

```text
PHP initial document
→ validated bootstrap
→ React store
→ user edits
→ DocumentPort synchronizes submission bridges
→ WordPress native save
→ PHP persists Markdown and sanitized compatibility HTML
```
## Components and Hooks
Use composition and focused hooks. Components render and handle direct interaction; runtime ports own WordPress and browser integration.

- Use context for stable services such as `EditorRuntime`, strings, and store access.
- Use selectors instead of passing large state objects through props.
- Use controller hooks for behavior reusable across visual treatments.
- Keep shared UI primitives free of EasyMDE domain decisions.
- Put error boundaries around independently recoverable regions.
- Do not swallow render or event errors to keep a broken control visible.
- Do not report success until the real asynchronous operation succeeds.
- Keep accessible names, disabled state, loading state, and visual state synchronized.
- Avoid components that query WordPress DOM, call REST directly, modify global classes, and manage unrelated features in one file.
## Markdown Editing
Markdown editing behavior belongs in pure domain modules:

- line-ending and title normalization;
- command transformations;
- outline parsing;
- statistics;
- table generation;
- selection calculations;
- publish-draft normalization;
- category-tree construction.

Import pure TypeScript modules directly in tests. Do not test them by reading production source text, extracting functions with regex, or evaluating a browser bundle in a VM.

Editing surfaces must preserve:

- selection start, end, and direction;
- IME composition;
- undo and redo history;
- focus entry and return;
- scroll position;
- clipboard behavior;
- keyboard shortcuts;
- repeated open and close cycles;
- edit, split, and preview view changes.

Do not replace the editing element during ordinary state updates when that would destroy selection, composition, undo, or scroll state.
## Preview Pipeline
The production preview path is:

```text
Markdown
→ PreviewPort
→ POST /easymde/v1/preview
→ PHP MarkdownRenderer
→ sanitized HTML and feature manifest
→ Mermaid, KaTeX, Highlight.js, and TOC enhancement
```

Rules:

- Do not add a second production Markdown renderer in React.
- Do not silently show approximate HTML when server rendering fails.
- Abort obsolete requests with `AbortController`.
- Pair each request with an increasing ID or document signature.
- Ignore responses that are no longer current.
- Keep a previous valid preview only when the UI clearly reports the new failure.
- Treat enhancement loading and execution failures as observable errors.
- Clean observers, timers, pending enhancement work, and generated DOM on replacement or unmount.
- Load enhancements only when required by the returned feature manifest.
- Never insert unsanitized Markdown, REST payloads, SVG, or generated HTML into the DOM.

Make stale-result handling explicit:

```ts
const requestId = ++requestSequence.current;
controller.current?.abort();
controller.current = new AbortController();

const result = await runtime.preview.render(input, {
  signal: controller.current.signal,
  requestId,
});

if (requestId === requestSequence.current) {
  setPreview(result);
}
```
## Publishing, Revisions, and Media
React presents these workflows; WordPress remains authoritative.

```text
React publish draft
→ PublishingPort preflight
→ synchronize required native fields
→ WordPress native save or publish
→ observe the real result
```

Publishing:

- Read capabilities and native-control availability through `PublishingPort`.
- Keep dialog changes isolated until confirmation.
- Fail clearly when a required control or capability is unavailable.
- Preserve categories, tags, excerpt, featured image, visibility, password, sticky state, schedule, status, and supported-post behavior.
- Do not call a replacement publishing endpoint for UI convenience.
- Do not submit until preflight and field synchronization succeed.

Revisions:

- Verify access to the current post.
- Load revision data through `RevisionPort`.
- Confirm before discarding unsaved changes.
- Restore Markdown and appearance data consistently.
- Let PHP regenerate `post_content`.
- Prevent stale revision responses from replacing newer state.

Media:

- Use `MediaPort` for the WordPress media frame and pasted-file upload.
- Preserve `upload_files` and post-specific permission checks.
- Accept only supported local image types and limits.
- Cancellation changes nothing.
- Restore editor focus and selection before inserting Markdown.
- Do not upload remote provider URLs through the local media endpoint.
## Effects and Lifecycle
Every effect needs a clear owner, trigger, cleanup, and failure path.

Clean up created listeners, observers, timers, animation frames, abort controllers, object URLs, portals, overlays, global classes, inline styles, CSS variables, scroll locks, and pointer capture.

Repeated activation must not multiply handlers or retain stale state. Work started for an old document, closed dialog, inactive surface, or unmounted component must not update the current UI.

Prefer event handlers and explicit commands for user actions. Use effects for external-system synchronization, not general control flow.
## Styling and UI Fidelity
- Scope admin application styles under a stable EasyMDE root.
- Preserve public article-theme, code-theme, rendered-content, and Mac code-frame contracts.
- Do not apply broad element rules to the WordPress admin.
- Do not use unrelated old classes as styling shortcuts.
- Avoid broad `!important`, arbitrary offsets, and child patches that hide an incorrect parent layout.
- Fix the first owning layout layer that diverges.
- Preserve DOM order when it carries reading, editing, or keyboard meaning.
- Use CSS Modules for isolated components when useful; keep public and integration selectors explicit.
- Preserve approved icons and local asset provenance.
- Test long text, translated labels, validation, empty/loading/error states, narrow viewports, zoom, and reduced motion.
- Treat focus-visible, contrast, keyboard access, dialog containment, focus return, and screen-reader state as component contracts.

When implementing an existing surface in React, preserve its observable behavior and protected selectors unless the linked task explicitly changes them.
## Internationalization
PHP remains the source of author-facing translated strings unless the repository defines another approved WordPress i18n bridge.

- Receive translated strings through typed bootstrap data.
- Do not hardcode user-facing English copy in production components.
- Include labels, placeholders, tooltips, notifications, empty states, errors, screen-reader text, and ARIA labels.
- Use interpolation instead of concatenating translated fragments.
- Keep message ownership scoped to the feature.
- Run repository i18n checks when strings change.
## Build Architecture
Use Vite from the root npm package. Expected scripts may include:

```json
{
  "dev:editor": "vite --config frontend/vite.config.ts",
  "build:editor": "vite build --config frontend/vite.config.ts",
  "typecheck:editor": "tsc --noEmit -p frontend/tsconfig.json",
  "lint:editor": "eslint frontend/src",
  "test:editor": "vitest run --config frontend/vitest.config.ts"
}
```

Add scripts only when the corresponding tool and source are present.

Use dedicated runtime output:

```text
assets/build/admin-editor/
├── editor.js
├── editor.css
├── manifest.json
└── chunks/
```

Rules:

- Keep TypeScript and React source under `frontend/`, not `assets/`.
- Keep primary WordPress entry names stable; use the manifest for chunks and extra assets.
- Build output must use local runtime assets only.
- PHP enqueue code must consume declared production output without exposing development paths.
- A required missing or stale entry is a build or release failure, not a reason to serve TypeScript source.
- Preserve WordPress dependencies, translations, versioning, and load order.
- Document each dependency's purpose and license.
- Keep third-party notices and lockfiles current.
## Testing
Choose tests by responsibility:

- `domain`: direct unit tests for pure functions and edge cases.
- `contracts`: schema and compile-time validation.
- `integrations`: WordPress DOM, REST, storage, clipboard, and failure-path tests.
- `features`: component and hook tests with a mock `EditorRuntime`.
- `app`: provider, store, error-boundary, and composition tests.
- `tests/e2e`: real WordPress flows using the installable release ZIP.
- release tests: compiled entries present; development-only files absent.

Cover relevant negative and repeated cases: permission denial, invalid nonces, missing native controls, preview failure, stale responses, cancelled media, storage failure, repeated mount/unmount, focus return, Escape, selection direction, IME, undo, scroll, large content, and release completeness.

Do not claim browser, WordPress, PHP, accessibility, visual, or release validation that was not actually performed.
## Release Packaging
The installable plugin ZIP contains PHP production code, templates, Composer runtime dependencies, translations, local vendor assets, and required compiled browser assets.

It must exclude:

```text
.agents/
frontend/
node_modules/
tests/
coverage/
Playwright output
TypeScript and React source
source maps unless explicitly required
Vite caches
local logs and configuration
unrelated development files
```

The source archive may include development source according to repository policy.

Before changing release behavior:

- inspect `scripts/build-release.mjs`;
- verify required compiled assets;
- confirm `.agents/` and `frontend/` are not installable-package paths;
- confirm Composer development packages are absent;
- confirm runtime assets and licenses are complete;
- inspect the produced ZIP instead of inferring contents.
## Prohibited Patterns
Do not introduce:

- Next.js, Webpack, another frontend framework, or a replacement publishing backend without explicit approval.
- Direct WordPress DOM, jQuery, `wp.apiFetch`, `wp.media`, or global bootstrap access from React components.
- A second production Markdown renderer.
- A universal adapter, god component, or giant unstructured component directory.
- Imports of another feature's private internals.
- Duplicated authority across React state, DOM fields, browser storage, and WordPress data.
- Silent fallback, swallowed errors, fake success, or hidden writes.
- Stale asynchronous work that can update current state.
- Effects without cleanup or repeated-lifecycle safety.
- TypeScript source under `assets/`.
- Remote CDN runtime dependencies.
- Placeholder modules, empty feature directories, speculative abstractions, or unused assets.
- Development source, tests, caches, local metadata, or secrets in the installable plugin package.
## Completion Checklist
1. Confirm the owning layer and feature.
2. Confirm PHP, WordPress, React, and browser state authority.
3. Confirm components use focused ports instead of environment globals.
4. Confirm error, cancellation, stale-result, and cleanup paths.
5. Confirm relevant Markdown, save, publish, revision, media, and compatibility contracts.
6. Confirm strings, accessibility, focus, keyboard, selection, IME, undo, scroll, and responsive states where relevant.
7. Run focused type, unit, integration, browser, i18n, and release checks available for changed paths.
8. Inspect the exact diff and generated output.
9. Inspect the installable plugin ZIP when build or release paths change.
10. Report what was and was not verified.
