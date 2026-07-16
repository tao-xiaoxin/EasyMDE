---
name: easymde
description: Use this skill when building, modifying, debugging, reviewing, or validating EasyMDE React and TypeScript admin-editor features or related browser-side interfaces, including WordPress integration, Markdown editing and preview, publishing, revisions, media, themes, custom CSS, settings, local state, WeChat export, AI assistance, testing, Vite builds, and release packaging.
---

# EasyMDE React Development Guide

EasyMDE is a standalone WordPress Markdown editor. React and TypeScript, built with Vite, are the browser-application architecture for the admin editor and related interactive interfaces.

This guide defines production ownership, persisted-data rules, dependency direction, runtime contracts, failure behavior, testing, and release boundaries. It is an implementation guide, not only a directory-layout suggestion or a generic React tutorial.

Before writing custom code, check whether EasyMDE already has a domain rule, WordPress service, REST endpoint, registry, compatibility API, native bridge, or reusable UI capability for the task. Extend the owning capability instead of creating a parallel path.

The root `AGENTS.md` remains authoritative. Follow it whenever it is stricter or more specific.

## Inspect Before Changing

Read the live repository before choosing files or abstractions:

```text
AGENTS.md
readme.txt
package.json
docs/ARCHITECTURE.md
docs/DEVELOPMENT.md
docs/TESTING_AND_RELEASE.md
src/Plugin.php
src/Admin/AdminAssets.php
src/Admin/EditorScreen.php
src/Admin/EditorSaveHandler.php
src/Admin/PostModeController.php
src/Admin/SettingsPage.php
src/Content/PostDocument.php
src/Content/RevisionManager.php
src/Content/MarkdownRenderer.php
src/Support/Migration.php
src/Support/ToolbarRegistry.php
src/Theme/
src/Rest/
src/Frontend/
templates/admin/editor-shell.php
templates/admin/settings-page.php
assets/js/admin/
assets/css/admin/
scripts/build-release.mjs
tests/
```

Do not assume every path proposed by this guide already exists. Create a directory, abstraction, or file only when the current feature needs it.

Trace the complete path before editing:

```text
PHP bootstrap or WordPress state
→ versioned browser contract
→ application store or feature model
→ React component
→ focused runtime port
→ WordPress, REST, or browser adapter
→ real save, publish, render, media, revision, settings, clipboard, or storage result
```

Inspect both the success path and the permission, validation, cancellation, stale-result, missing-control, dependency-unavailable, lock-loss, expired-security-token, repeated-lifecycle, and release-package paths.

For each changed behavior, record:

- the single owner before and after the change;
- the persisted authority and browser-session authority;
- the real external operation that proves success;
- the failure state shown to the user;
- the tests that prove no parallel path was introduced.

## Critical Authority Rules

- `_easymde_markdown` is the canonical Markdown source.
- `post_content` is sanitized rendered HTML for WordPress compatibility.
- `EasyMDE\Content\MarkdownRenderer`, backed by `league/commonmark`, is the only production Markdown renderer.
- PHP and WordPress own permissions, nonces, post meta, revisions, media, taxonomies, save, publish, post status, post locking, autosave, scheduling, settings persistence, public article output, and supported-post admission.
- React owns presentation, interaction state, feature composition, dialogs, panels, layout, and explicitly defined browser-session behavior in approved admin surfaces.
- Opening, closing, previewing, focusing, or cancelling UI must not create hidden writes.
- Cancellation is a zero-write result unless the product contract explicitly says otherwise.
- Missing required capabilities, controls, assets, bootstrap data, or runtime dependencies must fail clearly.
- React must not create another data authority, renderer, permission system, save path, publish path, media store, revision model, settings store, public-content authority, or timezone model.
- Client capability flags control presentation only; PHP and WordPress verify every protected action.
- A synchronized hidden field is a submission bridge, not proof that WordPress persisted the value.
- A successful browser promise is not proof of save, publish, upload, revision restore, settings update, or clipboard success unless it represents the real owning operation.

## Persisted Data and Editor Admission

Treat the existing post-meta contract as protected data:

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

- Never rename, remove, reinterpret, eagerly initialize, or silently invalidate an existing `_easymde_*` field without an explicit data-compatibility plan and tests.
- `_easymde_enabled` marks stored EasyMDE document state; it does not decide whether a supported post opens in the editor.
- `easymde_supported_post_types` and `PostModeController` own editor admission. Admission must not depend on `_easymde_enabled`, `_easymde_markdown`, or another document-state field.
- Opening an ordinary supported post without stored Markdown imports `post_content` into Markdown in memory through the existing PHP compatibility path. Opening must not write metadata, rewrite `post_content`, create a revision, or mark the post enabled.
- Do not add a browser HTML-to-Markdown importer for initial document loading. The PHP compatibility path remains authoritative.
- Empty stored Markdown is valid document state. Detection must preserve the existing `metadata_exists()` behavior rather than treating an empty string as absence.
- The next legitimate EasyMDE save writes `_easymde_enabled = 1`, stores Markdown and appearance fields, and keeps `post_content` synchronized with server-rendered HTML.
- `_easymde_render_signature` is an internal consistency marker only. It never replaces Markdown as authority and must be regenerated by the existing PHP owner.
- Stored compatibility HTML may be reused for initial preview only when PHP reports the render signature is current.
- Relevant EasyMDE meta participates in WordPress revisions. Restore must recover Markdown and appearance together and let PHP regenerate compatibility HTML.
- User appearance defaults advance only through the existing valid save path. Selecting or previewing a theme in React must not silently write user defaults.
- `_easymde_code_mac_style` and historical `codeMacStyle` values are preserved historical data. Do not read, write, normalize, copy, delete, expose, or restore them as active state.
- The fixed Mac-style code frame remains rendering behavior, not a user or document option.

## Protected Compatibility Contracts

Preserve the public facade methods:

```php
EasyMDE_Plugin::register_toolbar_button();
EasyMDE_Plugin::register_shortcode_helper();
```

Known protected WordPress extension boundaries include:

```text
easymde_supported_post_types
easymde_article_themes
easymde_code_themes
easymde_category_options_cache_context
easymde_category_options_load_failed
```

Current REST namespace and routes include:

```text
POST   /easymde/v1/preview
POST   /easymde/v1/media
GET    /easymde/v1/theme-options
POST   /easymde/v1/custom-css
POST   /easymde/v1/custom-css/preview
DELETE /easymde/v1/custom-css/{id}
GET    /easymde/v1/posts/{post_id}/revisions
GET    /easymde/v1/posts/{post_id}/revisions/{revision_id}
```

Rules:

- Inspect the live repository for additional public hooks, routes, script handles, CSS contracts, facade methods, DOM fields, and extension semantics before changing a feature.
- Keep `easymde/v1` stable. Do not create a second route namespace for React convenience.
- Existing extension commands and shortcode helpers must remain available to React surfaces through typed serialized contracts.
- Do not execute arbitrary JavaScript strings supplied by extension configuration.
- Preserve stable feature IDs and existing collision or replacement semantics unless a focused task explicitly changes the public contract.
- A feature handoff must inventory every protected selector, event, script handle, filter, action, route, meta key, and facade method it touches.
- Internal implementation details may change behind adapters, but observable extension behavior must remain compatible unless the linked task explicitly changes it.

## React Runtime Strategy

EasyMDE supports WordPress 6.7 or newer. Use the WordPress-provided element runtime through `@wordpress/element` and the `wp-element` script dependency. Do not ship a second React runtime into the WordPress admin.

Mount application roots with `createRoot` from `@wordpress/element` and always unmount the returned root during teardown:

```tsx
import { createRoot } from '@wordpress/element';

export function mountEditor(element: HTMLElement): () => void {
  const root = createRoot(element);
  root.render(<EditorApp />);

  return () => root.unmount();
}
```

Runtime rules:

- Keep React mounting and unmounting in `entrypoints/` or `integrations/wordpress/`.
- Import runtime hooks and APIs from `@wordpress/element` by default.
- Direct runtime imports from `react`, `react-dom`, or `react-dom/client` are prohibited unless the build maps them to the same WordPress runtime and bundle inspection proves no private React copy is shipped.
- The JSX transform is part of the runtime contract. Automatic JSX imports such as `react/jsx-runtime` must be mapped or externalized consistently, or the project must use a transform that targets the WordPress element runtime.
- Declare `wp-element` in generated WordPress dependency metadata.
- Configure Vite so `@wordpress/element`, React runtime modules, and any other WordPress-provided packages are not silently bundled.
- Do not pass components, elements, hooks, contexts, or portals between two different React runtimes.
- Do not add compatibility branches, legacy root-rendering fallbacks, or tests for unsupported WordPress versions below 6.7.
- An intentional private React runtime would require a separate repository-wide decision, bundle-size review, isolation proof, and explicit approval.
- Inspect production bundles for React implementation code instead of assuming externalization worked.

## Application Entrypoints and Root Ownership

Do not turn every admin interface into one permanent `EditorApp`.

Use one entrypoint per real WordPress screen or independently loaded application surface, for example:

```text
frontend/src/entrypoints/admin-editor.tsx
frontend/src/entrypoints/settings.tsx
```

Rules:

- Each entrypoint validates its own bootstrap contract, creates its own store and runtime, mounts one declared root, and owns teardown.
- Create a store per mounted application instance. Do not export a mutable module-level singleton store that leaks state across tests, repeated mounts, or different screens.
- The editor and settings page may share domain code, contracts, and UI primitives, but they must not share mutable application state.
- A dialog or panel inside the editor belongs to the editor application; a separate WordPress settings screen belongs to a separate application root.
- Do not use one root to take ownership of unrelated WordPress admin pages.
- Multiple roots on the same screen require explicit ownership, independent teardown, and proof that contexts or stores are not accidentally crossed.
- An entrypoint must not hide or disable the existing owner until bootstrap validation and React mounting succeed.
- Startup failure must leave a usable supported owner or show a clear fatal error. It must not leave a blank editor.

## Repository Layout

Keep one root npm package. React and TypeScript source belongs under `frontend/`; browser runtime output belongs under `assets/build/`.

Use this source structure as the default:

```text
frontend/
├── vite.config.ts
├── tsconfig.json
└── src/
    ├── entrypoints/
    │   ├── admin-editor.tsx
    │   └── settings.tsx
    ├── app/
    │   ├── editor/
    │   ├── settings/
    │   ├── providers/
    │   └── store/
    ├── contracts/
    │   ├── bootstrap/
    │   ├── errors.ts
    │   ├── safe-html.ts
    │   ├── editor-runtime.ts
    │   └── ports/
    ├── domain/
    │   ├── document/
    │   ├── markdown/
    │   ├── appearance/
    │   ├── publishing/
    │   ├── revisions/
    │   └── settings/
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

- `entrypoints/`: locate roots, parse bootstrap data, create runtimes and stores, mount, activate ownership, and report fatal startup failures.
- `app/`: screen-specific shells, providers, error boundaries, store construction, and top-level composition.
- `contracts/`: runtime-validated bootstrap schemas, ports, request/result types, safe-value brands, error codes, and public feature contracts.
- `domain/`: pure document, Markdown, outline, statistics, appearance, publishing, revision, and settings rules.
- `features/`: complete user-facing capabilities grouped by feature.
- `integrations/`: WordPress DOM, native form, REST, preview enhancement, media, storage, clipboard, diagnostics, and browser adapters.
- `shared/`: reusable UI, hooks, icons, utilities, and generic types without WordPress or feature ownership.
- `test/`: shared test setup, factories, fixtures, contract payloads, and mock runtimes.

Do not create a generic catch-all `components/`, `services/`, `helpers/`, or `utils/` directory at the application root.

## Dependency Direction

Use one-way dependencies:

```text
entrypoints  → app, contracts, integrations
app          → features, contracts, shared
features     → domain, contracts, shared
domain       → shared pure utilities and types only
contracts    → domain types and shared types only
integrations → contracts, domain, shared
shared       → no app, feature, integration, or WordPress ownership
```

Rules:

- `domain/` must not import React, WordPress packages, browser globals, DOM behavior, adapters, or feature modules.
- `contracts/` must not depend on concrete adapters.
- `shared/` must not become a disguised application layer.
- A feature may import another feature only through a documented public API; private-path imports are prohibited.
- Do not import upward into `app/` or `entrypoints/`.
- Circular imports are defects, not an acceptable consequence of barrel files.
- Keep `index.ts` exports intentional and small; do not create a repository-wide barrel that hides ownership.
- Enforce boundaries with ESLint restricted-import rules or an equivalent automated check when the frontend toolchain exists.
- Dependency injection flows from entrypoints toward features. Feature modules must not construct WordPress adapters for themselves.

## PHP and WordPress Composition

Keep PHP as the WordPress composition root. Prefer focused responsibilities such as:

```text
src/Admin/
├── AdminAssets.php          # register and enqueue production assets only
├── EditorBootstrapData.php  # build and validate serialized editor data
├── EditorAssetManifest.php  # resolve Vite entries, dependencies, and versions
├── EditorScreen.php         # prepare editor roots and native bridges
├── EditorSaveHandler.php    # preserve the native save contract
├── PostModeController.php   # decide whether EasyMDE owns the current post screen
└── SettingsPage.php         # preserve Options API and settings authority
```

Create files only when their responsibility is implemented. The names describe ownership, not a requirement to add empty scaffolding.

Rules:

- `src/Plugin.php` wires services and hooks; it does not accumulate editor business logic.
- `AdminAssets.php` must not become the owner of bootstrap construction, REST behavior, feature state, settings validation, or HTML rendering.
- PHP prepares versioned browser payloads instead of growing unrelated globals.
- Templates render prepared data, roots, nonces, and native submission bridges; they do not own business rules.
- REST controllers stay feature-focused under `src/Rest/` and keep namespace `easymde/v1`.
- PHP internal names remain `snake_case`; browser contract properties use `camelCase` only at the serialization boundary.
- Use `wp_json_encode()` and context-appropriate escaping. Never concatenate untrusted data into executable inline JavaScript.
- PHP capability checks, sanitizers, registries, renderers, revision logic, settings sanitizers, and save handlers remain authoritative even when React presents the UI.

## Contract Design and Schema Evolution

Parse external data at boundaries. TypeScript interfaces alone do not validate PHP or REST payloads.

Use runtime schemas for:

- editor bootstrap data;
- settings bootstrap data;
- REST requests and responses;
- extension commands and shortcode helpers;
- persisted browser-storage payloads;
- build manifests and asset metadata.

Representative editor bootstrap:

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
    blogId: number;
    locale: string;
    direction: 'ltr' | 'rtl';
    timezone: string;
    dateFormat: string;
    timeFormat: string;
  };
  document: DocumentSnapshot;
  appearance: AppearanceSnapshot;
  capabilities: EditorCapabilities;
  endpoints: EditorEndpoints;
  limits: EditorLimits;
  assets: EditorAssets;
  storage: EditorStorageKeys;
  publishing: PublishingBootstrap;
  settings: EditorSettingsSnapshot;
  strings: EditorStrings;
  commands: CommandDefinition[];
  shortcodeHelpers: ShortcodeHelperDefinition[];
}
```

Rules:

- Validate required fields before mounting.
- A missing endpoint, capability, translation, limit, asset, document field, or security source is a startup error, not a reason to substitute `{}` or invent a default.
- Unknown optional fields may be ignored for forward compatibility; unknown contract versions must fail clearly.
- Increment the contract version when a consumer cannot safely interpret an old payload.
- Do not change a field's meaning in place.
- Keep endpoint URLs, site timezone, locale formats, payload limits, storage identity, and feature availability in the owning contract rather than duplicating constants in components.
- Do not include provider credentials, cookies, private configuration, unrelated user data, or article content not required by the current screen.
- Components receive typed data through providers, store initialization, and runtime construction; they never read a global payload directly.
- New-post flows must handle post identity changing from `0` or `new` to a real ID without retaining stale storage keys, query keys, locks, or request ownership.
- Add cross-language contract tests: serialize representative payloads from PHP, parse them with the TypeScript runtime schema, and reject malformed or stale versions.
- Test field-name conversion at the boundary; do not mix `snake_case` and `camelCase` inside feature code.
- Keep one owner for each constant. Server limits and route names must not be copied into multiple components.

## Runtime Ports

React features depend on focused capabilities, not WordPress globals or DOM selectors.

```ts
export interface EditorRuntime {
  document: DocumentPort;
  save: SavePort;
  session: SessionPort;
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

Representative contracts:

```ts
export interface DocumentPort {
  readNativeSnapshot(): NativeDocumentSnapshot;
  synchronizeSubmissionBridge(snapshot: DocumentSubmissionSnapshot): void;
  applyEditorTransaction(transaction: DocumentTransaction): DocumentTransactionResult;
}

export interface SavePort {
  request(kind: 'draft' | 'update'): Promise<SaveResult>;
  subscribe(listener: (event: SaveEvent) => void): () => void;
}

export interface SessionPort {
  getPostIdentity(): PostIdentity;
  getCurrentRestNonce(): string;
  getLockState(): PostLockState;
  subscribe(listener: (event: SessionEvent) => void): () => void;
}

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

export interface ClipboardPort {
  writeRichText(input: ClipboardDocument): Promise<ClipboardResult>;
}

export interface DiagnosticsPort {
  report(error: EditorFailure, context: DiagnosticContext): void;
}
```

Port rules:

- `SavePort` triggers and observes the existing WordPress save/update controls. It does not call a replacement save endpoint.
- `PublishingPort` owns publish-specific field mapping and native publish confirmation, not ordinary document editing.
- `SessionPort` owns current post identity, lock state, capability changes, and current security-token access.
- `DocumentPort` owns editor transactions and native submission bridges; it does not persist post meta directly.
- Add another port only when a feature has a distinct external-system responsibility. Add `AiPort` for AI instead of placing provider behavior in `DocumentPort`.
- Keep ports small and cohesive. Do not grow a universal `EditorAdapter` or `WordPressService`.
- Return explicit result objects for cancellation, conflict, validation, and success instead of ambiguous booleans.
- Every subscription returns an idempotent unsubscribe function.

Only `entrypoints/` and the relevant integration modules may know:

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
document.execCommand
```

React components, domain modules, feature models, and shared UI must not access those details directly.

## Feature Ownership and Atomic Activation

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
settings
ai-assistant
```

Create only feature directories required by current work. Use only subdirectories that contain real code.

A feature may expose an intentional public API through `index.ts`. It may import `domain`, `contracts`, and `shared`, but must not import another feature's private files.

Promote code to `shared` only after it has a stable, genuinely shared responsibility.

Native JavaScript and React may coexist while features are implemented one at a time, but each behavior has exactly one active owner.

Activation sequence:

```text
locate expected native contract
→ validate bootstrap and required capabilities
→ create runtime and store
→ mount React root
→ verify the root reached ready state
→ activate React ownership
→ disable or detach only the previous owner for that feature
```

Rules:

- Define an explicit activation condition and one owner marker for every feature.
- Do not hide or detach the previous owner before React is ready.
- If startup fails before activation, preserve the existing usable owner and show a diagnostic.
- If startup fails after activation, restore or fail closed according to the feature's written ownership contract.
- Keep bridges narrow and directional; avoid event loops between native and React state.
- Do not attach native and React listeners to the same state-changing action when both can write.
- Do not run two preview schedulers, draft timers, shortcut managers, save observers, publish handlers, media handlers, or clipboard exporters.
- Do not use DOM presence alone as the source of ownership truth; use an explicit activation record owned by the entrypoint.
- Remove the previous owner only after behavior, failure paths, accessibility, browser validation, and release packaging are equivalent for the linked task.

## State Ownership

Use one store per application root for client state shared by multiple features. Prefer selector-based subscriptions so Markdown typing does not rerender unrelated UI.

Recommended editor slices:

```text
document    # Markdown, title, saved baseline, dirty state, selection metadata
appearance  # article theme, code theme, fonts, custom CSS selection
layout      # view mode, pane ratio, outline, open panels
session     # pending work, errors, active surface, capabilities, post identity, lock state
```

Rules:

- Keep temporary dialog input local until confirmation.
- Keep persisted authority in PHP and WordPress.
- Treat native fields as submission bridges, not a business-state store.
- Compute derived values with selectors or pure functions.
- Do not store the same fact in component state, context, the application store, a query cache, DOM fields, and browser storage.
- Do not use `useEffect` merely to mirror one React state value into another.
- Keep REST-backed collections such as revisions and custom CSS in a dedicated server-state owner with explicit invalidation after writes.
- Do not copy server-state collections into the application store for convenience.
- Update the saved baseline only after the real WordPress save result is observed.
- Persist only explicitly approved preferences with a versioned schema and documented recovery behavior.
- Handle unavailable storage, access exceptions, corrupted values, quota failures, and site/user/post identity changes.
- Query keys include every authority dimension that changes the result, such as site, user, post, locale, capability context, and feature-specific revision.
- Clear or re-key state when post identity changes.
- Never let a stale query or stream update a different post, root, dialog, or user session.

Document flow:

```text
PHP initial document
→ validated bootstrap
→ React store
→ user transaction
→ synchronous native submission bridge update
→ WordPress native save
→ PHP persists Markdown and sanitized compatibility HTML
→ adapter observes real success
→ store advances the saved baseline
```

## Native Form, Save, Autosave, Lock, and Nonce Bridge

The existing WordPress form remains the submission contract.

Protected EasyMDE fields currently include:

```text
easymde_enabled
easymde_markdown
easymde_markdown_theme
easymde_code_theme
easymde_custom_css_id
easymde_custom_font
easymde_windows_font
easymde_apple_font
easymde_serif_font
easymde_nonce
```

Rules:

- Keep field names and expected values compatible with `EditorSaveHandler` and `ThemeStateRepository`.
- Synchronize Markdown and appearance bridges synchronously after an accepted React transaction or before any native form serialization that depends on them.
- Do not leave a debounce window in which WordPress save, preview, unload checks, or another native observer can read stale values.
- Dispatch the exact `input` or `change` events required by the owning WordPress/native integration; do not synthesize broad global events.
- Preserve the native EasyMDE save nonce field. React does not generate or validate the PHP save nonce.
- Do not treat autosave as a successful canonical EasyMDE save unless the current PHP path actually persisted the canonical meta and returned an owning success signal.
- `EditorSaveHandler` intentionally distinguishes legitimate EasyMDE saves from WordPress autosave and revision activity. Do not bypass that distinction.
- Keep React dirty state and WordPress's unload/form dirty state aligned to the same saved baseline.
- Avoid duplicate unload prompts.
- `SavePort` must prevent accidental duplicate submissions and must observe the result after navigation, redirect, or native status update.
- A disabled, missing, replaced, or extension-modified native control is a preflight failure, not a reason to force-click it.
- Never use `force: true` behavior as an application strategy for disabled WordPress controls.
- Preserve WordPress Heartbeat, post locks, nonce refresh, authentication checks, and lock dialogs.
- Do not capture a REST nonce as an immutable application constant for the entire editor lifetime. Read it through the current WordPress-owned nonce source or update the adapter when WordPress refreshes security state.
- A `401` or invalid-nonce response must move the session into an explicit reauthentication/security state; do not silently retry mutations with the same nonce.
- If the post lock is lost or capability changes remove edit access, stop state-changing controls, cancel pending mutations, retain unsaved browser-session content, and explain the condition.
- Scheduling uses the WordPress site timezone and native scheduling fields, not the browser timezone.
- Native control availability may differ by post type and installed extensions; adapters discover and report the real contract.

## REST and Error Contracts

Centralize WordPress requests in `integrations/wordpress/rest-client.ts` or an equivalent focused module.

The REST client must:

- use endpoints from validated bootstrap data;
- obtain the current REST nonce from the owning security adapter;
- use same-origin credentials;
- serialize request names at the boundary;
- validate required response fields before returning domain data;
- normalize `WP_Error`, HTTP failures, network failures, malformed JSON, timeouts, and aborted requests into typed failures;
- preserve stable server error codes such as `easymde_markdown_too_large` and `easymde_commonmark_unavailable` where useful;
- never expose raw response HTML as a user message;
- never use string matching on translated messages for control flow.

Use stable client codes:

```ts
export type EditorErrorCode =
  | 'cancelled'
  | 'permission-denied'
  | 'invalid-nonce'
  | 'authentication-required'
  | 'not-found'
  | 'conflict'
  | 'validation'
  | 'payload-too-large'
  | 'renderer-unavailable'
  | 'network'
  | 'timeout'
  | 'dependency-unavailable'
  | 'native-contract-missing'
  | 'unknown';

export interface EditorFailure {
  code: EditorErrorCode;
  serverCode?: string;
  status?: number;
  field?: string;
  retryable: boolean;
  messageKey: keyof EditorStrings;
  cause?: unknown;
}
```

Rules:

- An aborted request is not a user-facing failure unless cancellation itself fails.
- Treat `401` as authentication/security state, `403` as permission state, `409` as conflict, `413` as a size limit, and `5xx` as unavailable behavior unless a more specific server code exists.
- Retry only safe idempotent reads and only with a bounded policy and cancellation.
- Never automatically retry save, publish, delete, settings update, media upload, custom CSS write, revision restore, or another mutation.
- Render server-provided messages as text only and keep logic based on stable codes.
- Do not send requests for unavailable capabilities merely to discover that the server rejects them; capability flags improve presentation while PHP remains the final verifier.

## Safe HTML and Preview DOM

Server-rendered preview HTML is allowed only through an explicit trusted boundary.

Use a branded value so ordinary strings cannot reach an HTML sink accidentally:

```ts
declare const sanitizedPreviewHtmlBrand: unique symbol;

export type SanitizedPreviewHtml = string & {
  readonly [sanitizedPreviewHtmlBrand]: true;
};
```

Rules:

- Only the preview integration may construct `SanitizedPreviewHtml`, and only after validating a successful response from the official preview route.
- Keep the `dangerouslySetInnerHTML` call in one small preview-owned component or adapter.
- Never pass Markdown, AI output, error HTML, arbitrary REST fields, custom CSS text, extension strings, or browser-storage content to an HTML sink.
- Treat sanitized server HTML and the returned feature manifest as separate validated fields.
- Local Mermaid, KaTeX, Highlight.js, and TOC enhancement may modify only the preview-owned DOM.
- Generated Mermaid SVG is allowed only from the approved local enhancement runtime and must be replaced or removed during preview cleanup.
- Strip or reject scripts, event attributes, unsupported URLs, and unexpected executable nodes even when a response shape is otherwise valid.
- Do not use a browser sanitizer as a substitute for `MarkdownRenderer` and `wp_kses_post()`.
- Error and empty states render normal React text and elements, not HTML strings.

## Public Frontend Boundary

React is the approved admin-interface architecture. It is not the default renderer for public posts.

Rules:

- Public EasyMDE content remains PHP-rendered, sanitized WordPress output based on `post_content`, selected themes, scoped custom CSS, and conditional local enhancement assets.
- Do not mount or hydrate the admin React application inside public `.easymde-rendered-content` roots.
- Do not enqueue admin-editor, settings, store, bootstrap, media, publishing, revision, or AI bundles on visitor-facing pages.
- Feeds, search, excerpts, REST consumers, email integrations, themes, plugins, no-JavaScript visitors, and operation with EasyMDE inactive must continue to receive usable compatibility HTML.
- Public Mermaid, KaTeX, Highlight.js, TOC, and related enhancements remain conditional local enhancements; they do not become a client-side Markdown-rendering authority.
- Frontend enhancements must be idempotent, scoped to EasyMDE-rendered roots, safe under repeated initialization, and independently cleanable where they create observers or generated nodes.
- Do not expose admin bootstrap data, nonces, capabilities, post locks, user settings, private endpoints, drafts, or AI configuration to visitors.
- Admin React changes must not make public article readability, SEO-visible content, feeds, or compatibility HTML depend on loading React.
- A visitor-facing React application requires a separate explicit product decision and must not be inferred from the admin architecture.

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
- vertical and horizontal scroll position;
- clipboard behavior;
- keyboard shortcuts;
- repeated open and close cycles;
- edit, split, and preview view changes.

Rules:

- Do not replace the editing element during ordinary state updates when that would destroy selection, composition, undo, or scroll state.
- Apply generated or programmatic document edits as explicit transactions so the user receives one predictable undo step and selection can be restored.
- A transaction records the before/after range, source, timestamp or operation ID, and intended selection result.
- Do not make document edits from render functions or mount effects.
- Shortcut handlers must ignore incompatible IME/composition states and editable controls outside the owning editor.
- Resolve shortcut conflicts against the complete command registry and user settings.
- Preserve current platform normalization for Windows/Linux and macOS.
- Initial HTML-to-Markdown compatibility conversion remains in PHP; editor domain code starts from the provided Markdown snapshot.

## Preview Pipeline

The production preview path is:

```text
Markdown
→ PreviewPort
→ POST /easymde/v1/preview
→ PHP MarkdownRenderer
→ wp_kses_post()-sanitized HTML and feature manifest
→ local Mermaid, KaTeX, Highlight.js, and TOC enhancement
```

Rules:

- Do not add a second production Markdown renderer in React.
- Do not silently show approximate HTML when server rendering fails.
- Respect the server's 1 MiB Markdown preview limit through the typed limits contract; do not duplicate an unversioned magic number in components.
- Abort obsolete requests with `AbortController`.
- Pair each request with an increasing ID and the relevant document/appearance signature.
- Ignore responses that are no longer current for the active post, root, document revision, or appearance state.
- Keep a previous valid preview only when the UI clearly reports that the newest render failed or is pending.
- Treat enhancement loading and execution failures as observable errors.
- Clean observers, timers, pending enhancement work, generated nodes, and feature state on replacement or unmount.
- Load enhancements only when required by the returned feature manifest.
- Initial stored `post_content` may be reused only when PHP says its render signature is current; otherwise show a provisional or pending state until server rendering completes.
- Preview status must expose loading, refreshing, current, provisional, stale, error, and empty states without conflating them.
- A preview that is refreshing, provisional, stale, empty, or failed cannot be used as successful export input.

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
  signature === createPreviewSignature(currentInput()) &&
  currentPostIdentity().key === input.postIdentity.key
) {
  setPreview(result);
}
```

## Publishing and Taxonomy

React presents publishing workflows; WordPress remains authoritative.

```text
React publish draft
→ PublishingPort preflight
→ synchronize required native fields
→ WordPress native publish action
→ observe the real result
```

Rules:

- Read capabilities and native-control availability through `PublishingPort`.
- Keep dialog changes isolated until confirmation.
- Opening, closing, or cancelling the dialog writes nothing.
- Fail clearly when a required control or capability is unavailable.
- Preserve categories, tags, excerpt, featured image, visibility, password, sticky state, schedule, status, and supported-post behavior.
- Do not call a replacement publishing endpoint for UI convenience.
- Do not submit until preflight and field synchronization succeed.
- Disable duplicate confirmation while a publish operation is pending.
- Preserve server validation errors and return focus to the owning control.
- Do not report success until WordPress confirms the real status change.
- Category and tag support depends on the current post type and registered taxonomies; do not assume `post` behavior for every supported type.
- Preserve native term filters and the current category hierarchy.
- Category-option caching must remain scoped by site, user, capability context, locale, post type, post ID, and term `last_changed` state.
- Preserve `easymde_category_options_cache_context`, including the ability for extensions to bypass caching by returning `false`.
- Preserve observable category-load failures and `easymde_category_options_load_failed`.
- Do not silently replace a failed category tree with an empty successful tree.

## Revisions

- Verify access to the current post before loading revision data.
- Load revision data through `RevisionPort` and the existing REST routes.
- Keep server limits and revision ownership rules authoritative.
- Confirm before discarding unsaved browser-session changes.
- Restore Markdown and appearance data consistently.
- Let PHP regenerate `post_content` and the render signature.
- Prevent stale revision responses from replacing a newer document, post, or dialog state.
- Treat autosaves and manual revisions as distinct display types without changing WordPress semantics.
- Do not mutate the current document merely by opening or previewing a revision.
- A restore result must identify the restored revision and the real resulting document baseline.
- Revision queries are keyed by post identity and invalidated after a real restore or save when appropriate.

## Media

- Use `MediaPort` for the WordPress media frame and pasted-file upload.
- Preserve `upload_files` and post-specific permission checks.
- Accept only the current server-supported local JPEG, PNG, GIF, and WebP inputs and server-provided byte limits.
- Cancellation changes nothing.
- Restore editor focus and selection before inserting Markdown.
- Preserve attachment identity and server-returned URLs; do not infer upload directories or public URLs.
- Revoke temporary object URLs and cancel stale uploads.
- Do not upload remote provider URLs through the local media endpoint.
- Do not insert Markdown until the upload succeeds and the current document transaction is still valid.
- Expose upload progress only when the underlying transport provides real progress.
- A failed upload must not leave placeholder Markdown, stale object URLs, or a fake attachment record.
- Validate MIME type, extension, and server response independently; do not trust the browser filename alone.

## Themes and Custom CSS

Theme and code-style behavior remains registry-driven.

- Keep article and code themes in their existing explicit PHP registries.
- Preserve `easymde_article_themes` and `easymde_code_themes` extension filters.
- Do not scan theme directories dynamically at runtime.
- Load only the selected theme and enhancement assets required by current Markdown.
- Preserve the shared fixed Mac code-frame contract across every theme.
- Theme IDs, labels, CSS handles, and availability come from validated server data; components do not invent options from asset folders.
- Unknown or removed theme IDs are normalized by the existing PHP authority and surfaced explicitly when user action is required.

Custom CSS remains server-authoritative:

- The library belongs to the current user's WordPress user meta.
- Full create, update, and delete operations require `unfiltered_html`.
- Preview, normalization, selector scoping, blocked-token checks, remote-loading rejection, size limits, and nested at-rule handling remain in `CustomCssPolicy` and existing REST endpoints.
- React must not implement a browser CSS parser as a security boundary.
- Preview changes remain temporary until explicit save.
- Custom CSS preview styles are scoped to preview-owned rendered content and removed on close, replacement, cancellation, or failure.
- Preserve the selected custom CSS ID and post-level CSS snapshot behavior.
- Published content must remain stable if a user later edits or removes the library entry because the post snapshot remains authoritative for that saved document.
- Handle duplicate names, permission denial, parser absence, invalid CSS, conflicts, remote-loading attempts, and deletion of the active entry explicitly.
- Do not place raw custom CSS in diagnostics, global admin styles, or unrelated application roots.

## Settings Application

The EasyMDE settings screen is a separate WordPress-owned application surface.

Rules:

- `manage_options` remains the required capability.
- WordPress Options API, `register_setting()`, and the PHP sanitization callback remain authoritative.
- React may present the settings form but must not write durable settings directly to localStorage or bypass the registered option sanitizer.
- Preserve the versioned settings payload and current fallback behavior for invalid or unknown stored values.
- Toolbar shortcut options are derived from the complete command registry, including extension commands.
- Shortcut normalization and conflict validation remain consistent with PHP rules.
- Invalid settings must preserve the last valid stored configuration and show the real validation errors.
- A settings application uses its own bootstrap schema, runtime, store, root, asset handle, and completion tests.
- Settings state must not import or mutate the active editor's browser-session store.
- A settings save is successful only after WordPress accepts and persists the sanitized option.
- Do not expose settings controls for capabilities or features unavailable to the current site configuration.

## Clipboard and WeChat Export

Keep rich-text export behind `ClipboardPort` and an explicit user gesture.

Rules:

- Export only from the current successful, settled, sanitized preview.
- Reject export while preview is empty, pending, refreshing, provisional, stale, or failed.
- Clone preview-owned DOM; do not move or mutate the live preview.
- Remove `script`, `style`, internal IDs, internal classes where required, live-region attributes, and enhancement bookkeeping attributes from the exported clone.
- Inline only the approved computed-style allowlist required by the existing WeChat contract.
- Produce both `text/html` and `text/plain` clipboard representations when supported.
- Use the modern Clipboard API when available and preserve the existing legacy copy path only as an explicit compatibility fallback.
- The legacy path must restore selection, ranges, focus, scroll position, and temporary DOM after success or failure.
- Clipboard denial, unsupported APIs, and browser failure are real failures; do not show success before the write succeeds.
- Export never saves, publishes, uploads media, changes the document, or writes browser storage.
- Do not include editor controls, pending indicators, error elements, private diagnostics, or hidden application metadata in copied content.

## Local Drafts

Local drafts are content recovery, not layout preferences. Keep them in the `local-drafts` feature behind `StoragePort`.

- Scope draft keys by site, user, and post identity.
- Keep layout preference keys separate from content-recovery keys.
- Version every stored payload.
- Store only minimum recoverable content and timestamps; never store nonces, credentials, publishing passwords, provider tokens, custom CSS library contents, or unrelated WordPress data.
- Throttle writes and make storage failures observable without blocking editing.
- Do not silently replace the current document with a stored draft; compare saved baselines and ask before overwriting newer content.
- Clear or advance a draft only after a real save succeeds for the same document state.
- Re-key new-post drafts safely when WordPress assigns a post ID.
- Prevent an old `new` draft from attaching to a different newly created post.
- Handle unavailable storage, quota errors, corrupted JSON, schema mismatch, clock anomalies, and logout/user changes.
- Local draft recovery does not change WordPress post status or prove that server data is saved.

## Extension Registries

- Serialize registered toolbar commands and shortcode helpers into validated typed bootstrap data.
- Do not hardcode React UI to built-in commands only.
- Validate command IDs, surfaces, groups, action types, icons, prefixes, suffixes, levels, labels, descriptions, and shortcut defaults at the boundary.
- Unsupported actions fail visibly or use an explicit extension adapter; never execute arbitrary JavaScript strings.
- Preserve dynamic translated labels and descriptions supplied by PHP.
- Shortcut conflict resolution includes extension commands and user settings.
- Command execution uses document transactions and focused ports, not direct textarea or WordPress DOM access from components.
- Keep registry order and ID behavior deterministic.
- Changes to extension shape require versioned contracts, compatibility tests, and updated PHP and TypeScript validators.
- Do not expose internal service classes as a replacement for the public compatibility facade.

## Components, Hooks, and DOM Ownership

Use composition and focused hooks. Components render and handle direct interaction; runtime ports own WordPress and browser integration.

- Use context for stable services such as runtime, strings, and store access.
- Use selectors instead of passing large state objects through props.
- Use controller hooks for behavior reusable across visual treatments.
- Keep shared UI primitives free of EasyMDE domain and WordPress decisions.
- Put error boundaries around independently recoverable regions.
- Do not swallow render or event errors to keep a broken control visible.
- Do not report success until the real asynchronous operation succeeds.
- Keep accessible names, disabled state, loading state, and visual state synchronized.
- Do not add React Router for dialogs, tabs, or panels. WordPress owns editor-page navigation; add routing only for a real URL-addressable product requirement.

DOM rules:

- React owns only its declared root and portals it created.
- WordPress adapters may read or synchronize documented native fields, but components may not query them.
- Do not move, clone, or delete WordPress-owned controls merely to simplify layout.
- Portals into WordPress-owned regions require one explicit owner, cleanup, focus restoration, stacking-context analysis, and repeated mount/unmount tests.
- Global classes, body styles, scroll locks, cursors, and CSS variables require a single lifecycle owner.
- Do not use DOM mutation as an event bus; use typed callbacks, store actions, or focused adapter subscriptions.
- MutationObserver use must be scoped, disconnected on teardown, and justified by a WordPress-owned dynamic contract.
- Do not use CSS selectors as business identifiers when a typed ID can be passed through the contract.

## Effects and Lifecycle

Every effect needs a clear owner, trigger, cleanup, and failure path.

Clean up created listeners, observers, timers, animation frames, abort controllers, object URLs, portals, overlays, temporary style nodes, global classes, inline styles, CSS variables, scroll locks, selection changes, and pointer capture.

Repeated activation must not multiply handlers or retain stale state. Work started for an old document, closed dialog, inactive surface, replaced root, logged-out session, or unmounted component must not update the current UI.

Development Strict Mode and repeated mounts must not duplicate writes, network mutations, subscriptions, uploads, clipboard operations, or timers. Integration setup and teardown must be idempotent.

Prefer event handlers and explicit commands for user actions. Use effects for external-system synchronization, not general control flow.

Rules:

- Never start a mutation from an effect merely because state became truthy.
- Use stable operation IDs for long-running work.
- Capture the identity dimensions required to reject stale completion.
- Cleanup must be safe to call more than once and safe after partial setup failure.
- Error boundaries do not catch event-handler or asynchronous failures; those paths require explicit normalization and reporting.

## Performance and Loading

Keep the keystroke path small and predictable.

- Update browser-session Markdown immediately; debounce expensive preview work, not the user's text update.
- Do not parse the full document independently for preview scheduling, outline, statistics, syntax detection, dirty state, and AI context on every keystroke.
- Share pure derived results when ownership and invalidation are clear.
- Use selector subscriptions so title changes do not rerender preview-only controls and Markdown changes do not rerender unrelated dialogs.
- Lazy-load heavy optional panels and preview enhancements.
- Load Mermaid, KaTeX, Highlight.js, theme CSS, WeChat export code, revision UI, and AI code only when required.
- Cancel work for hidden, replaced, or unmounted surfaces.
- Use a worker only for measured CPU-heavy pure work, with typed messages, cancellation, versioned payloads, and no DOM or WordPress access.
- Measure large-document typing, preview latency, mount time, interaction latency, memory after repeated open/close, and production bundle output before claiming improvement.
- Add a bundle budget only after measuring the baseline and identifying which entries and chunks it protects.
- Do not optimize by weakening correctness, stale-result protection, accessibility, or failure reporting.

## Styling and UI Fidelity

- Scope admin application styles under a stable EasyMDE root.
- Preserve public article-theme, code-theme, rendered-content, and fixed Mac code-frame contracts.
- Do not apply broad element rules to WordPress admin.
- Do not use unrelated old classes as styling shortcuts.
- Avoid broad `!important`, arbitrary offsets, and child patches that hide an incorrect parent layout.
- Fix the first owning layout layer that diverges.
- Preserve DOM order when it carries reading, editing, or keyboard meaning.
- Use CSS Modules for isolated components when useful; keep public and integration selectors explicit.
- Use shared design tokens for intentional color, spacing, typography, radius, elevation, and motion values rather than duplicating magic numbers.
- Keep token ownership separate from article themes and public rendered-content CSS.
- Use logical CSS properties where direction can change.
- Support `dir="rtl"` and WordPress RTL behavior without mirroring icons or controls whose meaning must remain directional.
- Preserve approved icons and local asset provenance.
- Test long text, translated labels, validation, empty/loading/error states, narrow viewports, zoom, text scaling, software keyboards, reduced motion, and high-contrast modes.
- Treat focus-visible, contrast, keyboard access, dialog containment, focus return, live-region announcements, and screen-reader state as component contracts.
- Define a controlled z-index scale for application layers; do not win stacking problems with arbitrary large values.
- When implementing an existing surface in React, preserve observable behavior and protected selectors unless the linked task explicitly changes them.

## Internationalization, RTL, Date, and Time

PHP remains the source of current author-facing translated strings unless the repository defines another approved WordPress i18n bridge.

- Receive translated strings through validated bootstrap data.
- Do not hardcode user-facing English copy in production components.
- Include labels, placeholders, tooltips, notifications, empty states, errors, screen-reader text, confirmation text, and ARIA labels.
- Use interpolation instead of concatenating translated fragments.
- Keep message ownership scoped to the feature.
- Never use translated text as a programmatic key or error discriminator.
- Dynamic extension labels remain translated by PHP before serialization.
- Use WordPress locale, direction, date format, time format, and site timezone from the contract.
- Do not format scheduled publication using browser locale defaults when WordPress formats are available.
- Do not convert WordPress wall-clock scheduling into browser-local time as an authority decision.
- Test at least one long-string locale and RTL layout for changed shared surfaces.
- Run repository i18n checks when strings change.

## AI Assistant Boundary

When AI assistance is implemented, keep it behind a focused `AiPort` and explicit user action.

- Provider credentials and private endpoints remain server-side and never enter bootstrap data, browser storage, logs, or bundled code.
- Do not send article content, selections, attachments, or metadata until the user invokes a capability whose scope is visible.
- Represent selected context explicitly; do not silently include the full document.
- Streaming responses use an operation ID and `AbortController`; a cancelled or stale stream cannot update the current conversation or document.
- Generated document changes are proposals. Show the affected range or diff and apply only after confirmation through an undoable document transaction.
- AI output never saves, publishes, uploads media, changes settings, changes themes, invokes extensions, or performs another privileged action without separate explicit confirmation.
- Do not persist prompts or responses by default. Any history feature requires documented retention, deletion, privacy, encryption, access, and failure contracts.
- Treat model output as untrusted text. Never execute returned HTML, CSS, JavaScript, commands, URLs, or tool arguments directly.
- Tool invocations require typed allowlisted actions, server-side authorization, visible scope, and independent confirmation for state-changing work.
- Do not include hidden document content, credentials, diagnostics, or unrelated metadata in model context.
- AI failure must not block normal editing.

## Observability and Privacy

Failures must be diagnosable without exposing article content or environment secrets.

- Normalize failures at adapter boundaries and report stable codes through `DiagnosticsPort`.
- Separate user-facing translated messages from developer diagnostics.
- Include feature, operation, request ID, post ID when appropriate, contract version, and failure code.
- Omit Markdown, titles, excerpts, custom CSS, prompts, model output, publishing passwords, tokens, cookies, nonces, local paths, full URLs containing secrets, and raw server responses.
- Gate verbose browser diagnostics behind an explicit development or administrator setting.
- Do not leave unconditional `console.log`, performance traces, network payload dumps, or global debug objects in production output.
- Surface dependency, manifest, bootstrap, permission, lock, native-contract, renderer, and schema failures clearly instead of swallowing them.
- When information is insufficient, add focused diagnostics rather than speculative fallback behavior.
- Diagnostics transport must not create a remote telemetry dependency without explicit approval and privacy documentation.
- Test redaction with representative sensitive fields.

## Build Architecture

Use Vite from the root npm package. Keep focused commands for editor development, settings development, production build, type checking, linting, and tests. Add a script only when the corresponding tool and source are present.

Use dedicated runtime output per entrypoint, for example:

```text
assets/build/
├── admin-editor/
│   ├── editor.js
│   ├── editor.css
│   ├── editor.asset.php
│   └── chunks/
├── settings/
│   ├── settings.js
│   ├── settings.css
│   ├── settings.asset.php
│   └── chunks/
└── manifest.json
```

Rules:

- Keep TypeScript and React source under `frontend/`, not `assets/`.
- Treat generated manifest and asset metadata as the source of truth; PHP must not guess hashed names.
- Each entry metadata file declares exact WordPress script dependencies and a reproducible version hash.
- Keep primary WordPress script handles stable while content-hashed chunks may change.
- External mapping must cover every WordPress-provided runtime import actually used, including JSX runtime behavior.
- Build output must use local runtime assets only.
- PHP enqueue code consumes declared production output without exposing development paths.
- Missing, stale, duplicate, or inconsistent manifest entries are build or release failures, not reasons to serve TypeScript source.
- Production builds must never reference a Vite development server, localhost, temporary paths, or remote CDN assets.
- Development HMR is local-only, explicitly enabled, and never required for normal plugin operation.
- Dynamic-import and CSS asset URLs must resolve from the plugin asset base, not the web-root `/`.
- Verify chunk loading on WordPress installed in a subdirectory and when the plugin directory URL is not the assumed default.
- Do not hardcode `/wp-content/plugins/easymde/`.
- Multisite blog identity must not be confused with asset base or browser-storage identity.
- Preserve WordPress dependencies, translations, versioning, and load order.
- Keep JavaScript target compatible with documented browsers and WordPress 6.7-or-newer policy.
- Document each dependency's purpose and license.
- Keep third-party notices and lockfiles current.
- Verify a clean checkout produces the required entry graph using the lockfile.
- Inspect bundles to prove React is not duplicated and prohibited source maps or development references are absent.

## Dependency Policy

A frontend dependency is allowed only when it has a clear current responsibility.

Before adding one:

- identify the feature and boundary it owns;
- confirm the repository does not already provide the capability;
- compare a small local implementation when the need is narrow;
- verify browser and WordPress compatibility;
- inspect package size, transitive dependencies, maintenance, license, and runtime behavior;
- confirm it does not require remote assets or telemetry;
- define how it is tested and removed;
- update lockfiles and third-party notices.

Rules:

- Do not add a state, query, form, router, schema, animation, icon, or utility library only because it is conventional.
- Do not use two libraries for the same responsibility.
- Development-only tools must not enter installable runtime output.
- Runtime dependencies must be code-split only when loading behavior is predictable and failure is handled.
- A library does not become an architectural owner merely because it exposes an API.
- Wrap external libraries at a focused boundary when replacement, testing, or failure normalization matters.

## Testing and Architecture Enforcement

Choose tests by responsibility:

- `domain`: direct unit tests for pure functions and edge cases.
- `contracts`: schema version, PHP/TypeScript fixture parity, error mapping, safe-value construction, and compile-time validation.
- `integrations`: WordPress DOM, native form, nonce updates, locks, REST, root mounting, settings, storage, clipboard, diagnostics, public frontend isolation, and failure paths.
- `features`: component and hook tests with mock runtimes.
- `app`: provider, per-root store, error-boundary, activation, query ownership, and composition tests.
- `tests/e2e`: real WordPress author and public-content flows using the installable release ZIP.
- release tests: compiled entries present and development-only files absent.

Add automated architecture checks when the frontend toolchain exists:

- TypeScript strict mode and `noEmit` type checking.
- ESLint dependency-direction and restricted-global rules.
- A rule that components cannot import WordPress adapters or use WordPress/browser globals directly.
- A rule that runtime React imports follow the approved WordPress element strategy.
- A test that no private React runtime is present in production bundles.
- A build-manifest test that every declared entry, CSS file, dependency, and chunk exists.
- A PHP-to-TypeScript bootstrap contract test.
- REST request/response fixture tests for each used route.
- A release test that installable ZIP includes compiled runtime assets and excludes frontend source and repository-only files.

Cover relevant negative and repeated cases:

- `createRoot` mounting and teardown on WordPress 6.7 and latest supported WordPress;
- startup failure before and after ownership activation;
- independent editor and settings roots;
- permission denial, authentication expiry, invalid nonces, refreshed security state, and post-lock loss;
- stale native fields at save/autosave boundaries;
- disabled or missing native save/publish controls;
- ordinary supported post opening with zero writes;
- empty stored Markdown and first legitimate save;
- preview failure, 1 MiB limit, stale responses, provisional preview, and renderer absence;
- cancelled or failed media operations;
- storage denial, corrupt local drafts, and new-post re-keying;
- duplicate custom CSS names, unsafe CSS, parser absence, and active-entry deletion;
- registered extension commands, unsupported actions, and shortcut conflicts;
- settings validation and preservation of last valid values;
- WeChat export from current preview and rejection of pending/error previews;
- public articles rendering without admin React bundles, admin bootstrap data, or client-side Markdown authority;
- repeated mount/unmount, Strict Mode, focus return, Escape, selection direction, IME, undo, scroll, and cleanup;
- RTL, long translations, site-timezone scheduling, and WordPress date formats;
- large content, dynamic chunks, subdirectory installation, and bundle loading;
- release completeness and privacy-safe artifacts.

Do not claim browser, WordPress, PHP, accessibility, visual, performance, AI, settings, clipboard, public frontend, or release validation that was not actually performed.

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
development-server metadata
unrelated development files
```

The source archive may include development source according to repository policy.

Before changing release behavior:

- inspect `scripts/build-release.mjs` and release tests;
- build every required Vite entry before packaging;
- verify compiled assets and WordPress dependency metadata;
- confirm `.agents/` and `frontend/` are not installable-package paths;
- confirm Composer development packages are absent;
- confirm runtime assets, licenses, and third-party notices are complete;
- inspect the produced ZIP instead of inferring contents;
- search built JavaScript and CSS for localhost, Vite client code, source paths, remote CDNs, private endpoints, and duplicated React runtime code;
- install the ZIP into a clean supported WordPress environment and exercise changed editor, settings, and public-content paths;
- verify dynamic chunks load from the installed plugin URL;
- confirm public pages do not enqueue admin-only React entries.

## Prohibited Patterns

Do not introduce:

- A Gutenberg-based editor replacement, Next.js, Webpack, another frontend framework, or a replacement publishing backend without explicit approval.
- A bundled React runtime by accident, mixed WordPress/private React runtimes, or unreviewed JSX runtime imports.
- Direct WordPress DOM, jQuery, `wp.apiFetch`, `wp.media`, storage, clipboard, or global bootstrap access from React components.
- A browser HTML-to-Markdown importer that replaces the current PHP compatibility path.
- A second production Markdown renderer or browser CSS parser used as a security boundary.
- Raw string access to `dangerouslySetInnerHTML` outside the safe preview boundary.
- Mounting or hydrating admin React applications on public rendered posts without a separate explicit product decision.
- A universal adapter, god component, giant unstructured component directory, or one mutable store shared by unrelated roots.
- Imports of another feature's private internals, upward imports, or circular dependencies.
- Duplicated authority across React state, query state, DOM fields, browser storage, WordPress options, and post meta.
- Two active owners for preview, shortcuts, drafts, save, publishing, media, settings, clipboard, or another state-changing feature.
- Silent fallback, swallowed errors, fake success, hidden writes, force-clicking disabled controls, or automatic mutation retries.
- Stale asynchronous work that can update current state.
- Effects without cleanup, idempotence, or repeated-lifecycle safety.
- Compatibility branches or legacy root-rendering fallbacks for unsupported WordPress versions below 6.7.
- Browser-local scheduling that disagrees with WordPress site timezone.
- Hardcoded built-in-only command registries that break extension APIs.
- TypeScript source under `assets/`.
- Root-relative plugin asset URLs, hardcoded plugin directory URLs, remote CDN runtime dependencies, or production development-server references.
- Placeholder modules, empty feature directories, speculative abstractions, or unused assets.
- Article content, custom CSS, AI context, settings secrets, nonces, or credentials in diagnostics.
- Development source, tests, caches, local metadata, or secrets in the installable plugin package.

## Completion Gate

Before declaring a React feature complete:

1. Identify the single owner for every changed behavior and state value.
2. Confirm PHP, WordPress, React, query, native-field, option, public-content, and browser-storage authority.
3. Confirm persisted meta and settings contracts touched by the feature remain compatible.
4. Confirm ordinary supported-post opening remains zero-write where relevant.
5. Confirm components use typed contracts and focused ports rather than environment globals.
6. Confirm WordPress 6.7-or-newer runtime compatibility, `createRoot` teardown, and per-root store isolation.
7. Confirm atomic activation, startup failure, repeated activation, and previous-owner behavior.
8. Confirm native field synchronization, real save/publish observation, nonce/security refresh, lock loss, and dirty baseline behavior.
9. Confirm permission, validation, cancellation, stale-result, missing-control, schema, and dependency-failure behavior.
10. Confirm Markdown, preview, save, publish, revision, media, theme, custom CSS, extension, settings, clipboard, local-draft, and public-frontend contracts the feature touches.
11. Confirm strings, RTL, dates, accessibility, focus, keyboard, selection, IME, undo, scroll, responsive, reduced-motion, and timezone behavior where relevant.
12. Run focused type, unit, contract, integration, browser, i18n, performance, and release checks available for changed paths.
13. Inspect the exact diff, generated manifest, WordPress dependency metadata, production bundles, and installable ZIP.
14. Verify dynamic assets on the installed plugin URL, confirm public pages exclude admin React entries, and confirm no private React runtime or development reference is shipped.
15. Report what was verified, what was not verified, and every remaining risk without inventing evidence.
