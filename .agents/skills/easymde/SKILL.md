---
name: easymde
description: Use this skill when building, modifying, debugging, reviewing, or validating EasyMDE React and TypeScript admin-editor features or related browser-side interfaces, including WordPress integration, Markdown editing and preview, publishing, revisions, media, themes, custom CSS, local state, AI assistance, testing, Vite builds, and release packaging.
---

# EasyMDE React Development Guide

EasyMDE is a standalone WordPress Markdown editor. React and TypeScript, built with Vite, are the browser-application architecture for the admin editor and related interactive interfaces.

This guide defines production ownership, dependency direction, runtime contracts, failure behavior, testing, and release boundaries. It is not only a directory-layout suggestion.

Before writing custom code, check whether EasyMDE already has a domain rule, WordPress service, REST endpoint, registry, compatibility API, or reusable UI capability for the task. Extend the owning capability instead of creating a parallel path.

The root `AGENTS.md` remains authoritative. Follow it whenever it is stricter or more specific.

## Inspect Before Changing

Read the live repository before choosing files or abstractions:

```text
AGENTS.md
readme.txt
package.json
docs/ARCHITECTURE.md
src/Plugin.php
src/Admin/AdminAssets.php
src/Admin/EditorScreen.php
src/Admin/EditorSaveHandler.php
src/Admin/PostModeController.php
src/Content/
src/Theme/
src/Rest/
src/Frontend/
src/Support/ToolbarRegistry.php
templates/admin/editor-shell.php
assets/js/admin/
assets/css/admin/
scripts/build-release.mjs
tests/
```

Do not assume every path in this guide already exists. Create a directory or file only when the current feature needs it.

Trace the complete path before editing:

```text
PHP bootstrap or WordPress state
→ typed browser contract
→ application store or feature model
→ React component
→ focused runtime port
→ WordPress, REST, or browser adapter
→ real save, publish, render, media, revision, or storage result
```

Inspect both the success path and the permission, validation, cancellation, stale-result, missing-control, dependency-unavailable, and repeated-lifecycle paths.

## Critical Authority Rules

- `_easymde_markdown` is the canonical Markdown source.
- `post_content` is sanitized rendered HTML for WordPress compatibility.
- `EasyMDE\Content\MarkdownRenderer`, backed by `league/commonmark`, is the only production Markdown renderer.
- PHP and WordPress own permissions, nonces, post meta, revisions, media, taxonomies, save, publish, post status, post locking, autosave, scheduling, and supported-post admission.
- React owns presentation, interaction state, feature composition, dialogs, panels, layout, and explicitly defined browser-session behavior.
- Opening, closing, previewing, focusing, or cancelling UI must not create hidden writes.
- Cancellation is a zero-write result unless the product contract explicitly says otherwise.
- Missing required capabilities, controls, assets, bootstrap data, or runtime dependencies must fail clearly.
- React must not create another data authority, renderer, permission system, save path, publish path, media store, revision model, or timezone model.
- Client capability flags control presentation only; PHP and WordPress verify every protected action.
- Preserve these public compatibility APIs:

```php
EasyMDE_Plugin::register_toolbar_button();
EasyMDE_Plugin::register_shortcode_helper();
```

## React Runtime Strategy

Use the WordPress-provided element runtime through `@wordpress/element` and the `wp-element` script dependency by default. Do not accidentally ship a second React runtime into the WordPress admin.

The minimum supported WordPress version is authoritative. EasyMDE currently supports WordPress 6.0, while `createRoot` is not available through `@wordpress/element` on every supported version. Keep root mounting behind one compatibility adapter:

```ts
export interface MountedRoot {
  render(node: React.ReactNode): void;
  unmount(): void;
}

export function mountWordPressRoot(element: HTMLElement): MountedRoot {
  // Use createRoot when the current WordPress runtime provides it.
  // Otherwise use the supported legacy render/unmount pair.
}
```

Rules:

- Keep React mounting and unmounting in `entrypoints/` or `integrations/wordpress/`.
- Declare `wp-element` in generated WordPress asset dependency metadata.
- Configure Vite so `@wordpress/element` is not silently bundled when the production runtime is WordPress-provided.
- Do not pass components, elements, hooks, or contexts between two different React runtimes.
- Do not use a React API that is unavailable on the minimum supported WordPress version without a tested compatibility adapter.
- An intentional decision to bundle a private React runtime must be repository-wide, documented, size-reviewed, and isolated from WordPress React components.

## Repository Layout

Keep one root npm package. React and TypeScript source belongs under `frontend/`; browser runtime output belongs under `assets/build/`.

Use this source structure as the default:

```text
frontend/
├── vite.config.ts
├── tsconfig.json
└── src/
    ├── entrypoints/
    │   └── admin-editor.tsx
    ├── app/
    │   ├── EditorApp.tsx
    │   ├── EditorProviders.tsx
    │   ├── EditorErrorBoundary.tsx
    │   ├── createEditorRuntime.ts
    │   └── store/
    ├── contracts/
    │   ├── bootstrap.ts
    │   ├── errors.ts
    │   ├── editor-runtime.ts
    │   └── ports/
    ├── domain/
    │   ├── document/
    │   ├── markdown/
    │   ├── appearance/
    │   ├── publishing/
    │   └── revisions/
    ├── features/
    ├── integrations/
    │   ├── wordpress/
    │   ├── preview-runtime/
    │   └── browser/
    ├── shared/
    │   ├── ui/
    │   ├── hooks/
    │   ├── icons/
    │   ├── lib/
    │   └── types/
    └── test/
```

Responsibilities:

- `entrypoints/`: read bootstrap data, create runtime and store, mount roots, and report fatal startup failures.
- `app/`: shell, providers, error boundaries, store construction, top-level composition, and application-wide styles.
- `contracts/`: typed bootstrap schemas, ports, request/result types, error codes, and runtime interfaces.
- `domain/`: pure document, Markdown, outline, statistics, appearance, publishing, and revision rules.
- `features/`: complete user-facing capabilities grouped by feature.
- `integrations/`: WordPress DOM, REST, preview enhancement, storage, clipboard, diagnostics, and browser adapters.
- `shared/`: reusable UI, hooks, icons, utilities, and generic types without WordPress or feature ownership.
- `test/`: shared test setup, factories, fixtures, and mock runtimes.

Do not create a generic catch-all `components/` directory at the application root.

## Dependency Direction

Use one-way dependencies:

```text
entrypoints → app, contracts, integrations
app         → features, contracts, shared
features    → domain, contracts, shared
domain      → shared pure utilities and types only
contracts   → domain types and shared types only
integrations→ contracts, domain, shared
shared      → no app, feature, integration, or WordPress ownership
```

Rules:

- `domain/` must not import React, WordPress packages, browser globals, DOM types used as behavior, or feature modules.
- `contracts/` must not depend on concrete adapters.
- A feature may import another feature only through an explicitly documented public API; private-path imports are prohibited.
- Do not import upward into `app/` or `entrypoints/`.
- Circular imports are defects, not an acceptable consequence of barrel files.
- Keep `index.ts` exports intentional and small; do not create a repository-wide barrel that hides ownership.
- Enforce these boundaries with ESLint restricted-import rules or an equivalent automated check when the frontend toolchain is present.

## PHP and WordPress Composition

Keep PHP as the WordPress composition root. Prefer focused responsibilities such as:

```text
src/Admin/
├── AdminAssets.php          # register and enqueue production assets only
├── EditorBootstrapData.php  # build and validate the serialized browser contract
├── EditorAssetManifest.php  # resolve Vite entries, dependencies, and versions
├── EditorScreen.php         # prepare and render the editor root and native bridges
├── EditorSaveHandler.php    # preserve the native WordPress save contract
└── PostModeController.php   # decide whether EasyMDE owns the current post screen
```

Create these files only when their responsibility is implemented. The names describe ownership, not a requirement to add empty scaffolding.

Rules:

- `src/Plugin.php` wires services and hooks; it does not accumulate editor business logic.
- `AdminAssets.php` must not become the owner of bootstrap construction, REST behavior, feature state, or HTML rendering.
- PHP prepares one versioned browser payload instead of growing unrelated localized globals.
- Templates render prepared data, the React root, nonces, and native submission bridges; they do not own business rules.
- REST controllers stay feature-focused under `src/Rest/` and keep the fixed namespace `easymde/v1`.
- PHP internal names remain `snake_case`; browser contract properties use `camelCase` only at the serialization boundary.
- Use `wp_json_encode()` and context-appropriate escaping. Never concatenate untrusted data into executable inline JavaScript.

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

Create only feature directories required by current work. Use only subdirectories that contain real code.

A feature may expose an intentional public API through `index.ts`. It may import `domain`, `contracts`, and `shared`, but must not import another feature's private files.

Promote code to `shared` only after it has a stable, genuinely shared responsibility.

### Feature handoff and coexistence

Native JavaScript and React may coexist while features are implemented one at a time, but each behavior has exactly one active owner.

- Define an explicit activation condition for the React owner.
- Keep the bridge narrow and directional; avoid event loops between native and React state.
- Do not attach native and React listeners to the same action when both can write.
- Do not run two preview schedulers, two draft timers, two shortcut managers, or two publish handlers.
- Remove the previous owner only after behavior, failure paths, browser validation, and release packaging are equivalent.
- Preserve the usable editor when a React entry cannot start; show a clear failure or use an explicitly supported existing owner, never an approximate hidden fallback.

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
  diagnostics: DiagnosticsPort;
}
```

Add another port only when a feature has a distinct external-system responsibility. For example, add an `AiPort` when AI assistance is implemented; do not put AI provider behavior into `DocumentPort`.

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

export interface DiagnosticsPort {
  report(error: EditorFailure, context: DiagnosticContext): void;
}
```

Keep ports small and cohesive. Add a method to the capability that owns it; do not grow a universal `EditorAdapter`.

Only `entrypoints/` and the relevant modules under `integrations/` may know:

```text
window.EasyMDEConfig
window.wp
wp.apiFetch
jQuery
WordPress native field selectors
native save and publish button selectors
wp.media
localStorage and sessionStorage
navigator.clipboard
```

React components, domain modules, and feature models must not access those details directly.

## Typed Bootstrap

Parse browser bootstrap data once in the entrypoint. Do not spread global configuration reads through the component tree.

Use a versioned contract that contains the data required to start the editor:

```ts
export interface EditorBootstrap {
  version: 1;
  post: {
    id: number;
    type: string;
    status: string;
    isNew: boolean;
  };
  site: {
    locale: string;
    timezone: string;
  };
  document: DocumentSnapshot;
  appearance: AppearanceSnapshot;
  capabilities: EditorCapabilities;
  endpoints: EditorEndpoints;
  limits: EditorLimits;
  assets: EditorAssets;
  strings: EditorStrings;
  commands: CommandDefinition[];
  shortcodeHelpers: ShortcodeHelperDefinition[];
}
```

Rules:

- Validate required fields before mounting.
- A missing endpoint, nonce, capability, translation, limit, asset, or document field is a startup error, not a reason to substitute `{}` or invent a default.
- Unknown optional fields may be ignored for forward compatibility; unknown contract versions must fail clearly.
- Keep endpoint URLs, nonces, site timezone, payload limits, and feature availability in the bootstrap contract rather than duplicating constants in components.
- Do not include credentials, provider secrets, cookies, private configuration, or data unrelated to the current editor session.
- Components receive typed data through providers, store initialization, and runtime construction; they never read the global payload directly.
- New-post flows must handle a post ID changing from `0` to a real ID without retaining stale storage keys or request ownership.

## REST and Error Contracts

Centralize WordPress requests in `integrations/wordpress/rest-client.ts` or an equivalent focused module.

The REST client must:

- use endpoints from validated bootstrap data;
- attach the WordPress REST nonce and same-origin credentials correctly;
- serialize request names at the boundary;
- validate required response fields before returning domain data;
- normalize `WP_Error`, HTTP failures, network failures, malformed JSON, and aborted requests into typed failures;
- never expose raw response HTML as an error message;
- never use string matching on translated messages for control flow.

Use stable error codes:

```ts
export type EditorErrorCode =
  | 'cancelled'
  | 'permission-denied'
  | 'invalid-nonce'
  | 'not-found'
  | 'conflict'
  | 'validation'
  | 'payload-too-large'
  | 'renderer-unavailable'
  | 'network'
  | 'dependency-unavailable'
  | 'unknown';

export interface EditorFailure {
  code: EditorErrorCode;
  status?: number;
  field?: string;
  retryable: boolean;
  messageKey: keyof EditorStrings;
  cause?: unknown;
}
```

Rules:

- An aborted request is not a user-facing failure unless cancellation itself fails.
- Treat `401` and `403` as authorization state, `409` as conflict, `413` as a size limit, and `5xx` as unavailable behavior unless a more specific server code exists.
- Retry only safe, idempotent reads and only with a bounded policy.
- Never automatically retry save, publish, delete, media upload, custom CSS write, or another state-changing request.
- Render server-provided user messages as text only and keep logic based on stable codes.

## State Ownership

Use one application store under `app/store/` for client state shared by multiple features. Prefer selector-based subscriptions so Markdown typing does not rerender unrelated UI.

Recommended slices:

```text
document    # Markdown, title, saved baseline, dirty state, selection metadata
appearance  # article theme, code theme, fonts, custom CSS selection
layout      # view mode, pane ratio, outline, open panels
session     # pending work, errors, active surface, capabilities, post identity
```

Rules:

- Keep temporary dialog input local until confirmation.
- Keep persisted authority in PHP and WordPress.
- Treat native form fields as submission bridges, not a business-state store.
- Compute derived values with selectors or pure functions.
- Do not store the same fact in component state, context, the global store, a query cache, and DOM fields.
- Do not use `useEffect` merely to mirror one React state value into another.
- Keep REST-backed collections such as revisions and custom CSS in a dedicated server-state/query owner with explicit invalidation after writes; do not duplicate them in the application store.
- Update the saved baseline only after the real WordPress save result is observed.
- Persist only explicitly approved preferences with a versioned schema and documented recovery behavior.
- Handle unavailable storage, access exceptions, corrupted values, quota failures, and site/user/post identity changes.

Document flow:

```text
PHP initial document
→ validated bootstrap
→ React store
→ user edits
→ DocumentPort synchronizes native submission bridges
→ WordPress native save
→ PHP persists Markdown and sanitized compatibility HTML
→ adapter observes success and advances the saved baseline
```

### Local drafts

Local drafts are content storage, not layout preferences. Keep them in the `local-drafts` feature behind `StoragePort`.

- Scope keys by site, user, and post identity.
- Version the stored payload.
- Store only the minimum recoverable content and timestamps; never store nonces, credentials, publishing passwords, provider tokens, or unrelated WordPress data.
- Throttle writes and make storage failures observable without blocking editing.
- Do not silently replace the current document with a stored draft; compare baselines and ask the user when recovery would overwrite newer content.
- Clear or advance a draft only after a real save succeeds for the same document state.
- Re-key new-post drafts safely when WordPress assigns a post ID.

## Components, Hooks, and DOM Ownership

Use composition and focused hooks. Components render and handle direct interaction; runtime ports own WordPress and browser integration.

- Use context for stable services such as `EditorRuntime`, strings, and store access.
- Use selectors instead of passing large state objects through props.
- Use controller hooks for behavior reusable across visual treatments.
- Keep shared UI primitives free of EasyMDE domain decisions.
- Put error boundaries around independently recoverable regions.
- Do not swallow render or event errors to keep a broken control visible.
- Do not report success until the real asynchronous operation succeeds.
- Keep accessible names, disabled state, loading state, and visual state synchronized.
- Do not add React Router for dialogs, tabs, or panels. WordPress owns editor-page navigation; add routing only for a real URL-addressable product requirement.

DOM rules:

- React owns only its declared root and portals it created.
- WordPress adapters may read or synchronize documented native fields, but components may not query them.
- Do not move, clone, or delete WordPress-owned controls merely to simplify layout.
- Portals into WordPress-owned regions require one explicit owner, cleanup, focus restoration, and tests for repeated mount/unmount.
- Global classes, body styles, scroll locks, and CSS variables require a single lifecycle owner.
- Do not use DOM mutation as an event bus; use typed callbacks, store actions, or focused adapter subscriptions.

## Native Editor Lifecycle

Preserve WordPress editor behavior rather than imitating it in React.

- Keep the native form, EasyMDE nonce, Markdown field, appearance fields, and publish controls as the submission contract.
- Preserve WordPress Heartbeat, post locks, autosave, revision creation, and unload protection.
- Avoid duplicate unsaved-change prompts. React dirty state and the WordPress form dirty state must describe the same saved baseline.
- If a post lock is lost or the current user can no longer edit, stop state-changing UI and explain the condition.
- Do not mark the document saved because fields were synchronized; mark it saved only after the actual save succeeds.
- Scheduling uses the WordPress site timezone and native scheduling fields, not the browser timezone.
- Capability and native-control availability may differ by post type and installed extensions; adapters must discover and report the real contract.

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

Apply generated or programmatic document edits as explicit editor transactions so the user receives one predictable undo step and the selection can be restored.

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
- Respect the server Markdown size limit; do not duplicate an unversioned magic number in components.
- Abort obsolete requests with `AbortController`.
- Pair each request with an increasing ID and the relevant document/appearance signature.
- Ignore responses that are no longer current.
- Keep a previous valid preview only when the UI clearly reports the new failure.
- Treat enhancement loading and execution failures as observable errors.
- Clean observers, timers, pending enhancement work, and generated DOM on replacement or unmount.
- Load enhancements only when required by the returned feature manifest.
- Never insert unsanitized Markdown, REST payloads, SVG, or generated HTML into the DOM.
- Initial stored `post_content` may be reused only when PHP says its render signature is current; otherwise show provisional/pending state until server rendering completes.

Make stale-result handling explicit:

```ts
const requestId = ++requestSequence.current;
const signature = createPreviewSignature(input);
controller.current?.abort();
controller.current = new AbortController();

const result = await runtime.preview.render(input, {
  signal: controller.current.signal,
  requestId,
});

if (
  requestId === requestSequence.current &&
  signature === createPreviewSignature(currentInput())
) {
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
- Disable duplicate confirmation while a publish operation is pending.
- Preserve server validation errors and return focus to the owning control.

Revisions:

- Verify access to the current post.
- Load revision data through `RevisionPort`.
- Keep the server limit and revision ownership rules authoritative.
- Confirm before discarding unsaved changes.
- Restore Markdown and appearance data consistently.
- Let PHP regenerate `post_content`.
- Prevent stale revision responses from replacing newer state.
- Treat autosave and manual revisions as distinct display types without changing WordPress semantics.

Media:

- Use `MediaPort` for the WordPress media frame and pasted-file upload.
- Preserve `upload_files` and post-specific permission checks.
- Accept only supported local image types and server-provided limits.
- Cancellation changes nothing.
- Restore editor focus and selection before inserting Markdown.
- Preserve attachment identity and server-returned URLs; do not infer upload paths.
- Revoke temporary object URLs and cancel stale uploads.
- Do not upload remote provider URLs through the local media endpoint.

## Themes, Custom CSS, and Extension Registries

Theme and code-style behavior remains registry-driven.

- Keep article and code themes in their existing explicit PHP registries.
- Preserve `easymde_article_themes` and `easymde_code_themes` extension filters.
- Do not scan directories dynamically at runtime.
- Load only the selected theme and the enhancement assets required by the current Markdown.
- Preserve the shared Mac code-frame contract across every theme.
- Theme IDs and labels come from validated bootstrap data; components do not invent options from asset folders.

Custom CSS remains server-authoritative:

- The library belongs to the current user's WordPress user meta.
- Full editing requires `unfiltered_html`.
- Preview, normalization, selector scoping, blocked-token checks, size limits, and nested at-rule handling remain in `CustomCssPolicy` and the custom CSS REST endpoints.
- React must not implement a browser CSS parser as a security boundary.
- Preview changes remain temporary until explicit save.
- Preserve the selected custom CSS ID and post-level CSS snapshot behavior.
- Handle duplicate names, permission denial, parser absence, invalid CSS, conflicts, and deletion of the active entry explicitly.

Extension registries:

- Serialize registered toolbar commands and shortcode helpers into typed bootstrap data.
- Do not hardcode the UI to built-in commands only.
- Validate command shape and supported action types at the boundary.
- Unsupported extension actions must fail visibly or use an explicit extension adapter; never execute arbitrary JavaScript strings.
- Preserve dynamic translated labels and descriptions supplied by the PHP registry.
- Shortcut conflict resolution must include registered extension commands, not only built-ins.

## Effects and Lifecycle

Every effect needs a clear owner, trigger, cleanup, and failure path.

Clean up created listeners, observers, timers, animation frames, abort controllers, object URLs, portals, overlays, global classes, inline styles, CSS variables, scroll locks, and pointer capture.

Repeated activation must not multiply handlers or retain stale state. Work started for an old document, closed dialog, inactive surface, or unmounted component must not update the current UI.

Development Strict Mode and repeated mounts must not duplicate writes, network mutations, subscriptions, uploads, or timers. Integration setup and teardown must be idempotent.

Prefer event handlers and explicit commands for user actions. Use effects for external-system synchronization, not general control flow.

## Performance and Loading

Keep the keystroke path small and predictable.

- Update the canonical browser-session Markdown state immediately; debounce expensive preview work, not the user's text update.
- Do not parse the full document independently for preview scheduling, outline, statistics, syntax detection, and dirty state on every keystroke.
- Share pure derived results when ownership and invalidation are clear.
- Use selector subscriptions so title changes do not rerender preview-only controls and Markdown changes do not rerender unrelated dialogs.
- Lazy-load heavy optional panels and preview enhancements.
- Load Mermaid, KaTeX, Highlight.js, theme CSS, and AI code only when required.
- Cancel work for hidden, replaced, or unmounted surfaces.
- Use a worker only for measured CPU-heavy pure work, with typed messages, cancellation, and no DOM or WordPress access.
- Measure large-document typing, preview latency, mount time, and production bundle output before claiming a performance improvement.

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
- Test long text, translated labels, validation, empty/loading/error states, narrow viewports, zoom, text scaling, software keyboards, and reduced motion.
- Treat focus-visible, contrast, keyboard access, dialog containment, focus return, and screen-reader state as component contracts.

When implementing an existing surface in React, preserve its observable behavior and protected selectors unless the linked task explicitly changes them.

## Internationalization

PHP remains the source of author-facing translated strings unless the repository defines another approved WordPress i18n bridge.

- Receive translated strings through typed bootstrap data.
- Do not hardcode user-facing English copy in production components.
- Include labels, placeholders, tooltips, notifications, empty states, errors, screen-reader text, and ARIA labels.
- Use interpolation instead of concatenating translated fragments.
- Keep message ownership scoped to the feature.
- Never use translated text as a programmatic key or error discriminator.
- Run repository i18n checks when strings change.

## AI Assistant Boundary

When AI assistance is implemented, keep it behind a focused `AiPort` and an explicit user action.

- Provider credentials and private endpoints remain server-side and never enter bootstrap data, browser storage, logs, or bundled code.
- Do not send article content, selections, attachments, or metadata until the user invokes a capability whose scope is visible.
- Represent selected context explicitly; do not silently include the full document.
- Streaming responses use an operation ID and `AbortController`; a cancelled or stale stream cannot update the current conversation or document.
- Generated document changes are proposals. Show the affected range or diff and apply only after confirmation through `DocumentPort` as an undoable transaction.
- AI output never saves, publishes, uploads media, changes settings, or invokes another privileged action without a separate explicit confirmation.
- Do not persist prompts or responses by default. Any history feature requires a documented retention, deletion, privacy, and failure contract.
- Treat model output as untrusted text. Never execute returned HTML, CSS, JavaScript, commands, or tool arguments directly.

## Observability and Privacy

Failures must be diagnosable without exposing article content or environment secrets.

- Normalize failures at adapter boundaries and report stable error codes through `DiagnosticsPort`.
- Separate user-facing translated messages from developer diagnostics.
- Include feature, operation, request ID, post ID when appropriate, and failure code; omit Markdown, titles, custom CSS, prompts, tokens, cookies, nonces, local paths, and raw server responses.
- Gate verbose browser diagnostics behind an explicit development or administrator setting.
- Do not leave unconditional `console.log`, performance traces, network payload dumps, or global debug objects in production output.
- Surface dependency, manifest, bootstrap, permission, and renderer failures clearly instead of swallowing them.
- When information is insufficient, add focused diagnostics rather than speculative fallback behavior.

## Build Architecture

Use Vite from the root npm package. Keep focused commands for editor development, production build, type checking, linting, and tests. Add a script only when the corresponding tool and source are present.

Use dedicated runtime output:

```text
assets/build/admin-editor/
├── editor.js
├── editor.css
├── editor.asset.php
├── manifest.json
└── chunks/
```

Rules:

- Keep TypeScript and React source under `frontend/`, not `assets/`.
- Use `frontend/src/entrypoints/admin-editor.tsx` as the declared application entry.
- Treat the generated manifest and asset metadata as the source of truth; PHP must not guess hashed chunk names.
- `editor.asset.php` or equivalent generated metadata declares WordPress script dependencies and a reproducible version hash.
- Keep the primary WordPress script handle stable while chunks and content hashes may change.
- Build output must use local runtime assets only.
- PHP enqueue code must consume declared production output without exposing development paths.
- A required missing or stale entry is a build or release failure, not a reason to serve TypeScript source.
- A production build must never reference a Vite development server, localhost, a temporary path, or a remote CDN.
- Development HMR is local-only and cannot be required for normal plugin operation.
- Preserve WordPress dependencies, translations, versioning, and load order.
- Keep the JavaScript target compatible with the documented browser and minimum WordPress support policy.
- Document each dependency's purpose and license.
- Keep third-party notices and lockfiles current.
- Verify a clean checkout can produce the same required entry graph using the lockfile.

## Testing and Architecture Enforcement

Choose tests by responsibility:

- `domain`: direct unit tests for pure functions and edge cases.
- `contracts`: schema, version, error mapping, and compile-time validation.
- `integrations`: WordPress DOM, REST, root mounting, storage, clipboard, diagnostics, and failure-path tests.
- `features`: component and hook tests with a mock `EditorRuntime`.
- `app`: provider, store, error-boundary, query ownership, and composition tests.
- `tests/e2e`: real WordPress flows using the installable release ZIP.
- release tests: compiled entries present; development-only files absent.

Add automated architecture checks when the frontend toolchain exists:

- TypeScript strict mode and `noEmit` type checking.
- ESLint dependency-direction and restricted-global rules.
- A test that React components cannot import WordPress adapters or use WordPress globals.
- A build-manifest test that every declared entry, CSS file, dependency, and chunk exists.
- A release test that the installable ZIP includes compiled runtime assets and excludes frontend source and repository-only files.

Cover relevant negative and repeated cases:

- WordPress 6.0 root mounting and a newer `createRoot` path;
- permission denial and invalid nonces;
- missing native controls and post-lock loss;
- preview failure, size limits, stale responses, and renderer absence;
- cancelled or failed media operations;
- storage denial, corrupt local drafts, and new-post re-keying;
- duplicate custom CSS names, unsafe CSS, parser absence, and active-entry deletion;
- registered extension commands and shortcut conflicts;
- repeated mount/unmount, Strict Mode, focus return, Escape, selection direction, IME, undo, and scroll;
- site-timezone scheduling;
- large content and bundle loading;
- release completeness and privacy-safe artifacts.

Do not claim browser, WordPress, PHP, accessibility, visual, performance, AI, or release validation that was not actually performed.

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
- verify required compiled assets and WordPress dependency metadata;
- confirm `.agents/` and `frontend/` are not installable-package paths;
- confirm Composer development packages are absent;
- confirm runtime assets and licenses are complete;
- inspect the produced ZIP instead of inferring contents;
- install the ZIP into a clean supported WordPress environment and exercise the changed editor path.

## Prohibited Patterns

Do not introduce:

- Next.js, Webpack, another frontend framework, or a replacement publishing backend without explicit approval.
- A bundled React runtime by accident or mixed WordPress/private React runtimes.
- Direct WordPress DOM, jQuery, `wp.apiFetch`, `wp.media`, storage, clipboard, or global bootstrap access from React components.
- A second production Markdown renderer or browser CSS parser used as a security boundary.
- A universal adapter, god component, or giant unstructured component directory.
- Imports of another feature's private internals, upward imports, or circular dependencies.
- Duplicated authority across React state, query state, DOM fields, browser storage, and WordPress data.
- Two active owners for preview, shortcuts, drafts, publishing, media, or another state-changing feature.
- Silent fallback, swallowed errors, fake success, hidden writes, or automatic retries of mutations.
- Stale asynchronous work that can update current state.
- Effects without cleanup, idempotence, or repeated-lifecycle safety.
- Browser-local scheduling that disagrees with the WordPress site timezone.
- Hardcoded built-in-only command registries that break extension APIs.
- TypeScript source under `assets/`.
- Remote CDN runtime dependencies or production references to a development server.
- Placeholder modules, empty feature directories, speculative abstractions, or unused assets.
- Article content, custom CSS, AI context, nonces, or credentials in diagnostics.
- Development source, tests, caches, local metadata, or secrets in the installable plugin package.

## Completion Gate

Before declaring a React feature complete:

1. Identify the single owner for every changed behavior and state value.
2. Confirm PHP, WordPress, React, query, and browser-storage authority.
3. Confirm components use typed contracts and focused ports rather than environment globals.
4. Confirm minimum WordPress runtime compatibility, root teardown, and repeated activation.
5. Confirm permission, validation, cancellation, stale-result, missing-control, and dependency-failure behavior.
6. Confirm Markdown, save, publish, revision, media, theme, custom CSS, extension, and local-draft contracts that the feature touches.
7. Confirm strings, accessibility, focus, keyboard, selection, IME, undo, scroll, responsive, and timezone behavior where relevant.
8. Run focused type, unit, integration, browser, i18n, performance, and release checks available for the changed paths.
9. Inspect the exact diff, generated manifest, WordPress dependency metadata, and installable ZIP.
10. Report what was verified, what was not verified, and every remaining risk without inventing evidence.
