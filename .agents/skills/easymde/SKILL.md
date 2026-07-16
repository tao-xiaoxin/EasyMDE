---
name: easymde
description: Use this skill when building, modifying, debugging, reviewing, or validating EasyMDE React and TypeScript admin-editor features or related browser-side interfaces, including WordPress integration, Markdown editing and preview, publishing, revisions, media, themes, custom CSS, settings, local state, WeChat export, AI assistance, accessibility, performance, testing, Vite builds, and release packaging.
---

# EasyMDE React Development Guide

EasyMDE is a standalone WordPress Markdown editor. React and TypeScript, built with Vite, are the browser-application architecture for the admin editor and related interactive interfaces.

This guide defines project ownership, directory structure, code style, persisted-data rules, dependency direction, runtime contracts, component composition, React 18 behavior, accessibility, failure handling, testing, and release boundaries. It is an implementation contract, not a generic React tutorial or a directory sketch.

Before writing code, inspect the live repository and extend the current owner. Do not create a parallel renderer, save path, state authority, adapter, component library, or build path because a generic React pattern suggests one.

## Rule Priority and Companion Skills

Apply instructions in this order:

1. The explicit task, linked GitHub Issue, and human maintainer decisions.
2. The root `AGENTS.md` and EasyMDE's established data, security, compatibility, extension, testing, privacy, and release contracts.
3. This EasyMDE Skill.
4. Other repository documentation that applies to the changed surface.
5. Generic companion Skills such as `react-best-practices`, `composition-patterns`, and `web-design-guidelines`.

When rules conflict, the higher project-specific rule wins. A generic Skill may strengthen implementation quality, but it must not:

- introduce Next.js, React Server Components, Server Actions, Webpack, Gutenberg replacement behavior, or another application architecture;
- override WordPress 6.7+, `@wordpress/element`, native save and publish, PHP rendering, REST permissions, post locks, nonce refresh, or release packaging;
- change EasyMDE's directory boundaries, state ownership, public APIs, design contract, or local-asset policy;
- turn a recommendation into a new dependency without a focused repository need.

### `react-best-practices`

Apply its React 18-compatible client rules when they fit this WordPress admin application:

- remove avoidable async waterfalls;
- code-split heavy optional features;
- subscribe to the smallest required state;
- derive values instead of mirroring state through effects;
- lazy-initialize expensive local state;
- use functional state updates where they remove stale closures;
- deduplicate global listeners;
- measure rerenders, interaction latency, memory, and bundles before claiming an improvement.

Do not apply its Next.js, RSC, server-action, `React.cache()`, `next/dynamic`, Next.js image, route hydration, or server-streaming rules. Do not mandate SWR or another query library. Do not use React 19-only APIs. React 18 `forwardRef()` and `useContext()` remain valid where required by a component contract.

`Promise.all()` is appropriate only for independent, authorized reads. Do not parallelize dependent operations, WordPress mutations, or requests that should not begin before capability and contract validation.

A narrow Feature `index.ts` is an architectural public boundary, not a broad barrel. Inside a Feature and for large third-party libraries, import concrete modules directly. Never use repository-wide `export *` barrels.

### `composition-patterns`

Apply composition deliberately:

- prefer explicit variants or discriminated unions when behavior or structure differs materially;
- use compound components for a cohesive multi-part control that genuinely shares state and semantics;
- expose provider contracts as focused `state`, `actions`, and `meta` interfaces when multiple implementations need the same UI;
- lift state only to the nearest owner that coordinates its consumers;
- prefer children for structural composition when the caller does not need internal render data.

Do not replace every component with a compound-component API. Boolean props remain appropriate for atomic native state such as `disabled`, `required`, `readOnly`, `aria-expanded`, or a single capability flag. Avoid combinations of booleans that permit impossible product states.

Provider composition must not make high-frequency Markdown state rerender an entire subtree. Use selector-based store access for editor-session state and context for stable services or narrowly scoped component families.

Skip React 19-only composition advice. Do not use `use(Context)` or ref-as-prop semantics while EasyMDE uses the WordPress 6.7 React 18 runtime.

### `web-design-guidelines`

Apply semantic HTML, accessible names, keyboard access, visible focus, field labels, error relationships, contrast, zoom, logical CSS properties, reduced-motion behavior, and safe external-link handling.

Project rules override generic website assumptions:

- EasyMDE is a WordPress admin application, not a Next.js website.
- The task's approved design and the root `AGENTS.md` UI fidelity workflow define responsive behavior; generic mobile-first breakpoints do not replace that contract.
- Do not close every dialog on backdrop click. Close only when cancellation is safe and the product contract permits it.
- Do not automatically retry mutations. Only bounded idempotent reads may be retried.
- Disable the duplicate state-changing action while pending, not every unrelated control on the screen.
- Explicit EasyMDE and WordPress appearance state overrides a generic `prefers-color-scheme` default.
- Core Web Vitals are not sufficient proof for an authenticated editor. Measure typing, preview, mount, interaction, memory, and bundle behavior that belongs to this plugin.

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

Do not assume every proposed path already exists. Create a directory, abstraction, configuration file, or dependency only when current work uses it.

Trace the complete path before editing:

```text
PHP bootstrap or WordPress state
→ versioned browser contract
→ application store or Feature model
→ React component
→ focused runtime port
→ WordPress, REST, or browser adapter
→ real save, publish, render, media, revision, settings, clipboard, or storage result
```

Inspect success and failure paths, including permission denial, validation, cancellation, stale completion, missing native controls, unavailable dependencies, post-lock loss, refreshed or expired security state, repeated lifecycle, and release packaging.

For each changed behavior, identify:

- the single owner before and after the change;
- the persisted authority and browser-session authority;
- the external operation that proves success;
- the user-visible failure state;
- the tests that prove no parallel path or duplicate owner exists.

## Critical Authority Rules

- `_easymde_markdown` is the canonical Markdown source.
- `post_content` is sanitized rendered HTML for WordPress compatibility.
- `EasyMDE\Content\MarkdownRenderer`, backed by `league/commonmark`, is the only production Markdown renderer.
- PHP and WordPress own permissions, nonces, post meta, revisions, media, taxonomies, save, publish, post status, post locking, autosave, scheduling, settings persistence, public article output, and supported-post admission.
- React owns presentation, interaction state, Feature composition, dialogs, panels, layout, and explicitly defined browser-session behavior on approved admin surfaces.
- Opening, closing, previewing, focusing, or cancelling UI must not create hidden writes.
- Cancellation is a zero-write result unless a written product contract explicitly says otherwise.
- Missing required capabilities, controls, assets, bootstrap data, or runtime dependencies must fail clearly.
- React must not create another data authority, renderer, permission system, save path, publish path, media store, revision model, settings store, public-content authority, or timezone model.
- Client capability flags control presentation only; PHP and WordPress verify every protected action.
- A synchronized hidden field is a submission bridge, not proof that WordPress persisted the value.
- A resolved browser promise is not proof of save, publish, upload, restore, settings update, or clipboard success unless it represents the real owning operation.

## React Runtime Strategy

EasyMDE supports WordPress 6.7 or newer. Use the WordPress-provided React 18 runtime through `@wordpress/element` and the `wp-element` script dependency. Do not ship a second React runtime.

Mount application roots with `createRoot` from `@wordpress/element` and always unmount the returned root:

```tsx
import { createRoot } from '@wordpress/element';

export function mountEditor(element: HTMLElement): () => void {
  const root = createRoot(element);
  root.render(<EditorApp />);

  return () => root.unmount();
}
```

Runtime rules:

- Keep root discovery, mounting, and unmounting in `entrypoints/` or the focused WordPress integration.
- Import React runtime APIs from `@wordpress/element` by default.
- Do not use React 19-only APIs such as `use(Context)`, Activity, ref-as-prop, or React 19-only actions.
- Use `forwardRef()` only when a React 18 component must expose a real DOM or editor handle; do not forward refs by default.
- Direct imports from `react`, `react-dom`, or `react-dom/client` are prohibited unless the build maps them to the exact WordPress runtime and bundle inspection proves no private copy is shipped.
- Map or externalize the automatic JSX runtime consistently. Do not let `react/jsx-runtime` silently add another runtime.
- Declare `wp-element` in generated WordPress dependency metadata.
- Do not pass components, elements, hooks, contexts, portals, or refs between different React runtimes.
- Do not add compatibility branches or legacy root-rendering fallbacks for WordPress versions below 6.7.
- Inspect production bundles instead of assuming runtime externalization worked.
- Do not use hydration APIs; EasyMDE admin roots are client-mounted application roots.

Do not adopt `@wordpress/components` as a second design system by default. When a focused task intentionally requires a native WordPress component, verify its WordPress 6.7 API, stability, visual contract, accessibility, dependencies, and bundle behavior, and isolate it behind a shared UI or integration boundary. Do not use private or experimental WordPress component APIs as durable product contracts.

## Application Entrypoints and Root Ownership

Use one entrypoint per real WordPress screen or independently loaded application surface:

```text
frontend/src/entrypoints/admin-editor.tsx
frontend/src/entrypoints/settings.tsx
```

Each entrypoint:

- locates and validates its root;
- parses its own versioned bootstrap contract;
- creates its own runtime and store;
- mounts exactly its declared application root;
- activates ownership only after readiness;
- owns complete teardown and startup failure reporting.

The editor and settings application may share contracts, pure domain code, and UI primitives. They must not share mutable application state, root providers, error-boundary state, query caches, or lifecycle owners.

A dialog or panel inside the editor belongs to the editor root. A separate WordPress settings screen belongs to a separate settings root. Multiple roots on one screen require explicit independent ownership and teardown.

Startup failure must preserve the previous usable owner or show a clear fatal state. Never hide the existing owner before bootstrap validation and React readiness.

## Repository Layout

Keep one root npm package and one root lockfile. React and TypeScript source belongs under `frontend/`. Compiled browser runtime belongs under `assets/build/`.

Use this as the default structure:

```text
frontend/
├── vite.config.ts
├── vitest.config.ts          # create only when Vitest is introduced
├── tsconfig.json
├── eslint.config.js          # create only when ESLint is introduced
└── src/
    ├── entrypoints/
    │   ├── admin-editor.tsx
    │   └── settings.tsx
    ├── app/
    │   ├── editor/
    │   │   ├── EditorApp.tsx
    │   │   ├── EditorProviders.tsx
    │   │   ├── EditorErrorBoundary.tsx
    │   │   ├── createEditorStore.ts
    │   │   ├── store/
    │   │   └── styles/
    │   └── settings/
    │       ├── SettingsApp.tsx
    │       ├── SettingsProviders.tsx
    │       ├── SettingsErrorBoundary.tsx
    │       ├── createSettingsStore.ts
    │       ├── store/
    │       └── styles/
    ├── contracts/
    │   ├── bootstrap/
    │   ├── ports/
    │   ├── errors.ts
    │   ├── safe-html.ts
    │   └── editor-runtime.ts
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
    │   │   ├── bootstrap/
    │   │   ├── editor/
    │   │   ├── settings/
    │   │   ├── rest/
    │   │   ├── publishing/
    │   │   ├── revisions/
    │   │   └── media/
    │   ├── preview-runtime/
    │   └── browser/
    ├── shared/
    │   ├── ui/
    │   ├── hooks/
    │   ├── icons/
    │   ├── lib/
    │   └── types/
    └── test/
        ├── setup.ts
        ├── fixtures/
        ├── factories/
        └── mock-runtime/
```

This corrects an important ownership problem: do not place one shared `app/store/` or `app/providers/` beside both `app/editor/` and `app/settings/`. Each application root owns its store, providers, error boundary, and app-level styles.

Responsibilities:

- `entrypoints/`: root discovery, bootstrap parsing, runtime/store construction, mounting, readiness activation, and teardown.
- `app/editor/`: editor shell, editor providers, editor error boundary, editor store, and top-level editor composition.
- `app/settings/`: settings shell, settings providers, settings error boundary, settings store, and top-level settings composition.
- `contracts/`: runtime-validated bootstrap schemas, ports, request/result types, safe-value brands, error codes, and stable Feature contracts.
- `domain/`: pure document, Markdown, outline, statistics, appearance, publishing, revision, and settings rules.
- `features/`: complete capabilities recognizable by a user.
- `integrations/`: WordPress DOM, native forms, REST, media, preview enhancement, storage, clipboard, diagnostics, and browser adapters.
- `shared/`: reusable UI and utilities with no EasyMDE Feature or WordPress ownership.
- `test/`: shared test setup and fixtures only; ordinary tests stay next to their source.

Do not create a second `frontend/package.json`, a second lockfile, generic root `components/`, `services/`, `helpers/`, or `utils/`, or empty speculative directories.

## Feature Structure

Group code by user capability, not technical type:

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

Create a Feature directory only when current work contains real code.

A substantial Feature may use:

```text
features/publishing/
├── ui/
│   ├── PublishDialog.tsx
│   ├── PublishSettings.tsx
│   └── CategoryTree.tsx
├── model/
│   ├── usePublishDraft.ts
│   ├── usePublishAction.ts
│   └── publishing-state.ts
├── styles/
│   └── publishing.css
├── publishing.types.ts
└── index.ts
```

Rules:

- Not every Feature needs every subdirectory.
- `ui/` renders and handles direct interaction.
- `model/` coordinates Feature state and calls ports; it does not implement WordPress or browser access.
- Feature-specific CSS stays with the Feature.
- Feature domain rules that are reusable without React belong in `domain/`.
- WordPress, REST, storage, clipboard, media, and DOM implementations belong in `integrations/`.
- `index.ts` exports only the intentional public API using explicit named exports. Never use `export *`.
- Other Features must not deep-import private Feature files.
- Inside a Feature, import concrete internal files directly rather than importing the Feature's own `index.ts`.
- Promote code to `shared/` only after it has a stable, genuinely cross-Feature responsibility.

## Code Style and Naming

Follow existing repository style around changed files. For new React/TypeScript code, use these defaults unless an established nearby convention is stricter:

```text
Directories              kebab-case
React components         PascalCase.tsx
Error boundaries         PascalCase.tsx
Hooks                    useFeatureName.ts
Pure function modules    camelCase.ts
WordPress adapters       PascalCase.ts
Port files               feature-port.ts
Type modules             feature.types.ts
CSS files                kebab-case.css
Tests                    source-name.test.ts or SourceName.test.tsx
```

Examples:

```text
PublishDialog.tsx
usePublishDraft.ts
validatePublishDraft.ts
WordPressPublishingAdapter.ts
publishing-port.ts
publishing.types.ts
publish-dialog.css
PublishDialog.test.tsx
```

TypeScript rules:

- Enable strict type checking when the frontend toolchain is introduced.
- Use `unknown` and runtime parsing at external boundaries; do not use `any` as a substitute for validation.
- Keep public contracts explicit and stable.
- Use discriminated unions for async state, operation results, and component variants that must exclude impossible combinations.
- Use `import type` for type-only dependencies.
- Use exhaustive switches with `assertNever()` for closed unions.
- Avoid non-null assertions. After one validated boundary check, narrow the value and pass the narrowed type.
- Do not use translated text, DOM selectors, labels, or CSS classes as business identifiers.
- Avoid deep relative imports across layers. Use the configured source alias only after the toolchain defines it.
- Do not mutate arrays or objects owned by state. Use browser syntax supported by the configured Vite target; do not assume `toSorted()` or another newer API is available without target verification or a local polyfill decision.
- Keep comments focused on ownership, compatibility, security, or non-obvious behavior. Do not narrate obvious JSX.
- Do not suppress type, lint, accessibility, or dependency-boundary errors without a narrow documented reason and a test.

Entrypoints should stay small and contain no Feature business logic, REST implementation, DOM selector details, theme behavior, or dialog state.

## Dependency Direction

Use one-way dependencies:

```text
entrypoints  → app, contracts, integrations
app          → features, contracts, shared
features     → domain, contracts, shared
domain       → shared pure utilities and types only
contracts    → domain types and shared types only
integrations → contracts, domain, shared
shared       → no app, Feature, integration, or WordPress ownership
```

Rules:

- `domain/` must not import React, WordPress packages, browser globals, adapters, or Feature modules.
- `contracts/` must not depend on concrete adapters.
- `shared/` must not become a disguised application layer.
- `integrations/` must not import Feature UI or app shells.
- Do not import upward into `app/` or `entrypoints/`.
- Circular imports are defects.
- Enforce boundaries with ESLint restricted-import rules or an equivalent automated check once the toolchain exists.
- Dependency injection flows from entrypoints toward app and Features. Features do not construct WordPress adapters.

## Component Composition and API Design

Components render state and handle direct interaction. Ports and adapters own WordPress and browser integration.

State ownership:

- Keep ephemeral input, hover state, unconfirmed dialog fields, local validation display, and temporary drag state in the nearest component or Feature provider.
- Put editor-session state shared by multiple Features in the editor store.
- Put settings-session state in the settings store.
- Keep REST-backed collections in one server-state owner with explicit invalidation.
- Keep durable authority in PHP and WordPress.

Component API rules:

- Prefer explicit components or a discriminated `variant` when structure or behavior differs.
- Do not create APIs such as `isCompact`, `isModal`, `isInline`, `isEditing`, and `isSpecial` whose combinations permit invalid states.
- Atomic booleans remain valid for native state such as `disabled`, `required`, `readOnly`, `selected`, or `aria-expanded`.
- Use compound components only when parts form one semantic control and need the same scoped state.
- A compound provider exposes a typed, minimal interface and throws a clear development error when used outside its owner.
- Keep high-frequency Markdown and selection state out of broad React Context values. Expose a stable store API and selectors instead.
- Prefer `children` for static structural composition. Use a render prop only when the caller needs live internal data that cannot be expressed through children or a focused hook.
- Shared UI primitives must not know post IDs, capabilities, WordPress selectors, REST endpoints, or EasyMDE Feature rules.
- A controlled component receives its value and update callback. An uncontrolled component owns its initial value. Do not switch modes during one lifecycle.
- Error boundaries isolate independently recoverable regions and reset on the identity that owns the region, such as post ID or settings screen instance.
- Error boundaries do not catch event-handler or asynchronous failures; normalize those explicitly.
- Do not add React Router for dialogs, tabs, or panels. WordPress owns page navigation unless a focused task introduces a real URL-addressable application route.

## State Ownership

Use one store per application root. Do not export a mutable module-level singleton.

Recommended editor slices:

```text
document    # Markdown, title, saved baseline, dirty state, selection metadata
appearance  # article theme, code theme, fonts, custom CSS selection
layout      # view mode, pane ratio, outline, open panels
session     # operations, errors, active surface, capabilities, post identity, lock state
```

Rules:

- Subscribe through selectors so Markdown typing does not rerender unrelated dialogs or settings.
- Compute dirty state and other derived facts from authoritative values; do not store duplicated flags.
- Do not mirror one React state value into another through `useEffect`.
- Do not duplicate the same fact across component state, context, store, query cache, DOM fields, and browser storage.
- Update the saved baseline only after the real WordPress save succeeds.
- Clear or re-key post-scoped state when a new post receives its real ID.
- Query keys include every authority dimension that changes the result, including site, user, post, locale, capability context, and Feature revision.
- Never let stale queries, streams, or timers update another post, root, dialog, or user session.
- Persist only explicitly approved preferences with a versioned schema and documented recovery behavior.
- Handle unavailable storage, access exceptions, corrupt values, quota failures, and site/user/post identity changes.

Document flow:

```text
PHP initial document
→ validated bootstrap
→ editor store
→ user transaction
→ synchronous native submission bridge update
→ WordPress native save
→ PHP persists Markdown and sanitized compatibility HTML
→ adapter observes real success
→ store advances the saved baseline
```

## Runtime Ports

React Features depend on focused capabilities, not WordPress globals or selectors:

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
  applyEditorTransaction(
    transaction: DocumentTransaction,
  ): DocumentTransactionResult;
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

- `DocumentPort` owns editor transactions and native submission bridges; it does not persist post meta.
- `SavePort` triggers and observes existing WordPress save/update controls; it does not call a replacement save endpoint.
- `PublishingPort` owns publish-specific field mapping and native publish confirmation.
- `SessionPort` owns current post identity, lock state, capability changes, and current security-token access.
- Add a port only for a distinct external-system responsibility. Use a focused `AiPort` rather than placing provider behavior in `DocumentPort`.
- Keep ports small and cohesive. Do not grow a universal `EditorAdapter` or `WordPressService`.
- Return explicit result objects for cancellation, conflict, validation, and success instead of ambiguous booleans.
- Every subscription returns an idempotent unsubscribe function.
- Test adapters against the port contract and Features against mock ports.

Only entrypoints and relevant integration modules may know:

```text
window.EasyMDEConfig
window.wp
wp.apiFetch
jQuery
WordPress native field selectors
native save and publish selectors
wp.media
localStorage and sessionStorage
navigator.clipboard
document.execCommand
```

Components, domain modules, Feature models, and shared UI must not access those details directly.

## PHP and WordPress Composition

PHP remains the WordPress composition root. Prefer focused responsibilities:

```text
src/Admin/
├── AdminAssets.php
├── EditorBootstrapData.php
├── EditorAssetManifest.php
├── EditorScreen.php
├── EditorSaveHandler.php
├── PostModeController.php
└── SettingsPage.php
```

Create a class only when its responsibility is implemented. Do not add empty scaffolding or one-method wrappers without a real boundary.

Rules:

- `src/Plugin.php` wires services and hooks; it does not accumulate editor business logic.
- `AdminAssets.php` registers and enqueues production assets. It does not own bootstrap construction, REST behavior, Feature state, settings validation, or HTML rendering.
- `EditorBootstrapData.php` builds versioned serialized data.
- `EditorAssetManifest.php` resolves Vite entries, CSS, WordPress dependencies, and versions.
- `EditorScreen.php` prepares roots and native bridges.
- `EditorSaveHandler.php` preserves native save behavior.
- Templates render prepared data, roots, nonces, and submission bridges; they do not own business rules.
- REST controllers stay focused under `src/Rest/` and keep namespace `easymde/v1`.
- PHP internal names remain `snake_case`; browser contract properties become `camelCase` only at serialization.
- Use `wp_json_encode()` and context-appropriate escaping. Never concatenate untrusted data into executable inline JavaScript.
- PHP capability checks, sanitizers, registries, renderer, revision logic, settings sanitizers, and save handlers remain authoritative.

## Contract Design and Schema Evolution

TypeScript interfaces do not validate PHP, REST, storage, manifests, or extensions. Parse external data at boundaries.

Use runtime schemas for:

- editor and settings bootstrap data;
- REST requests and responses;
- extension commands and shortcode helpers;
- persisted browser-storage payloads;
- build manifests and WordPress asset metadata.

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
- A missing endpoint, capability, translation, limit, asset, document field, or security source is a startup error, not a reason to invent a default.
- Unknown optional fields may be ignored; an unknown contract version fails clearly.
- Increment a version when a consumer cannot safely interpret an old payload. Do not change a field's meaning in place.
- Keep endpoint URLs, site timezone, locale formats, limits, storage identity, and Feature availability in the owning contract.
- Never serialize provider credentials, cookies, private configuration, unrelated user data, or article content not required by the screen.
- Components never read global bootstrap data directly.
- Handle post identity changing from `0` or `new` to a real ID without retaining stale storage keys, query keys, locks, or requests.
- Add cross-language tests that serialize representative PHP payloads and parse them through TypeScript schemas.
- Test `snake_case` to `camelCase` conversion at the boundary.
- Keep one owner for each limit and route constant.

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
- `_easymde_enabled` describes stored document state; it does not decide whether a supported post opens in EasyMDE.
- `easymde_supported_post_types` and `PostModeController` own editor admission.
- Opening an ordinary supported post without stored Markdown imports `post_content` in memory through the existing PHP compatibility path and performs zero writes.
- Do not add a browser HTML-to-Markdown authority for initial loading.
- Empty stored Markdown is valid. Preserve `metadata_exists()` semantics.
- The next legitimate EasyMDE save writes `_easymde_enabled = 1`, stores Markdown and appearance, and synchronizes `post_content`.
- `_easymde_render_signature` is an internal consistency marker and is regenerated by PHP.
- Reuse stored compatibility HTML only when PHP reports the render signature is current.
- Revisions restore Markdown and appearance together and let PHP regenerate compatibility HTML.
- Appearance defaults advance only through the existing valid save path.
- `_easymde_code_mac_style` and historical `codeMacStyle` values remain inactive historical data. Do not read, write, expose, normalize, copy, delete, or restore them as active state.
- The fixed Mac-style code frame remains rendering behavior, not a setting.

## Protected Compatibility Contracts

Preserve public facade methods:

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

Before changing a Feature, inspect the live repository for additional hooks, routes, script handles, CSS contracts, DOM fields, and extension semantics.

Rules:

- Keep `easymde/v1` stable. Do not create another namespace for React convenience.
- Serialize extension commands and shortcode helpers through validated typed contracts.
- Never execute arbitrary JavaScript strings supplied by extension configuration.
- Preserve stable IDs, ordering, collision behavior, and replacement semantics unless the linked task explicitly changes the public contract.
- Inventory every protected selector, event, script handle, filter, action, route, meta key, and facade method touched by the Feature.
- Internal implementation may change behind adapters; observable extension behavior remains compatible unless explicitly changed.

## Feature Ownership and Atomic Activation

Native JavaScript and React may coexist while Features are implemented one at a time, but each behavior has exactly one active owner.

Activation sequence:

```text
locate expected native contract
→ validate bootstrap and capabilities
→ create runtime and store
→ mount root
→ verify ready state
→ activate React ownership
→ disable or detach only the previous owner for that Feature
```

Rules:

- Define one explicit activation condition and owner marker.
- Do not hide or detach the previous owner before readiness.
- If startup fails before activation, preserve the usable owner and report the failure.
- If startup fails after activation, restore or fail closed according to the written Feature contract.
- Keep bridges narrow and directional; prevent native/React event loops.
- Do not attach two state-changing owners to one action.
- Do not run duplicate preview schedulers, draft timers, shortcut managers, save observers, publish handlers, media handlers, or clipboard exporters.
- DOM presence alone is not ownership truth.
- Remove the previous owner only after behavior, failure, accessibility, browser, and release checks pass for the linked task.

## Native Form, Save, Autosave, Lock, and Nonce Bridge

The existing WordPress form remains the submission contract.

Protected fields currently include:

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

- Keep names and values compatible with `EditorSaveHandler` and `ThemeStateRepository`.
- Synchronize Markdown and appearance bridges synchronously after an accepted transaction or before native serialization.
- Do not leave a debounce window in which save, autosave, unload checks, or native observers read stale fields.
- Dispatch only the exact `input` or `change` events required by the owner.
- React does not generate or validate the PHP save nonce.
- Do not treat WordPress autosave or revision activity as a successful canonical EasyMDE save unless the PHP owner actually persisted canonical meta.
- Keep React dirty state and WordPress unload/form dirty state aligned to one saved baseline.
- Avoid duplicate unload prompts.
- Prevent duplicate submissions and observe the result after navigation, redirect, or native status update.
- A disabled, missing, replaced, or extension-modified native control is a preflight failure. Never force-click it.
- Preserve Heartbeat, post locks, nonce refresh, authentication checks, and lock dialogs.
- Do not capture a REST nonce as an immutable application constant. Read the current WordPress-owned value or update the adapter when security state changes.
- A `401` or invalid-nonce response enters explicit authentication/security state; do not retry a mutation with the same nonce.
- If the lock is lost or edit capability disappears, stop mutations, cancel pending work, retain unsaved session content, and explain the condition.
- Scheduling uses WordPress site timezone and native fields.
- Native controls vary by post type and extensions; adapters discover and report the real contract.

## REST and Error Contracts

Centralize WordPress requests in a focused REST client.

The client must:

- use validated endpoint URLs;
- obtain the current REST nonce from the security owner;
- use same-origin credentials;
- serialize names at the boundary;
- validate responses before returning domain data;
- normalize `WP_Error`, HTTP failures, malformed JSON, network failures, timeouts, and aborts into typed results;
- preserve stable server error codes;
- never expose raw response HTML as a user message;
- never branch on translated messages.

Representative errors:

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

- Aborted reads are not user-facing failures unless cancellation itself fails.
- Treat `401`, `403`, `409`, `413`, and `5xx` according to stable security, permission, conflict, size, and availability semantics.
- Retry only safe idempotent reads with a bounded policy and cancellation.
- Never automatically retry save, publish, delete, settings update, media upload, custom CSS write, revision restore, or another mutation.
- Render server messages as text and use stable codes for logic.
- Capability flags improve presentation; PHP remains the final verifier.

## Safe HTML and Preview DOM

Server-rendered preview HTML crosses one explicit trusted boundary:

```ts
declare const sanitizedPreviewHtmlBrand: unique symbol;

export type SanitizedPreviewHtml = string & {
  readonly [sanitizedPreviewHtmlBrand]: true;
};
```

Rules:

- Only the preview integration constructs `SanitizedPreviewHtml`, after validating a successful official preview response.
- Keep `dangerouslySetInnerHTML` in one small preview-owned sink.
- Never send Markdown, AI output, error HTML, arbitrary REST fields, custom CSS text, extensions, or storage content to an HTML sink.
- Validate sanitized HTML and the Feature manifest as separate fields.
- Mermaid, KaTeX, Highlight.js, and TOC enhancement may modify only preview-owned DOM.
- Generated nodes must be replaced or removed during cleanup.
- Reject scripts, event attributes, unsupported URLs, and executable nodes even when the response shape is valid.
- A browser sanitizer does not replace `MarkdownRenderer` and `wp_kses_post()`.
- Empty and error states render ordinary React text and elements.

## Public Frontend Boundary

React is the admin-interface architecture, not the default public post renderer.

- Public EasyMDE content remains PHP-rendered, sanitized WordPress output based on `post_content`, selected themes, scoped custom CSS, and conditional local enhancement assets.
- Never mount or hydrate the admin React application inside public `.easymde-rendered-content`.
- Do not enqueue editor, settings, store, media, publishing, revision, or AI bundles on visitor pages.
- Feeds, search, excerpts, REST consumers, email integrations, themes, plugins, no-JavaScript visitors, and operation with EasyMDE inactive must receive usable compatibility HTML.
- Public enhancements remain conditional local enhancements, not a browser Markdown authority.
- Frontend enhancement is idempotent, root-scoped, repeat-safe, and cleanable.
- Never expose admin bootstrap data, nonces, capabilities, post locks, user settings, drafts, private endpoints, or AI configuration to visitors.
- Public readability, SEO-visible content, feeds, and compatibility HTML must not depend on React loading.

## Markdown Editing

Pure domain modules own:

- line-ending and title normalization;
- command transformations;
- outline parsing;
- statistics;
- table generation;
- selection calculations;
- publish-draft normalization;
- category-tree construction.

Import pure TypeScript directly in tests. Do not extract functions from production source with regex or execute browser bundles in a VM to prove domain behavior.

Editing surfaces preserve:

- selection start, end, and direction;
- IME composition;
- undo and redo history;
- focus entry and return;
- vertical and horizontal scroll;
- clipboard behavior;
- keyboard shortcuts;
- repeated open and close cycles;
- edit, split, and preview changes.

Rules:

- Do not replace the editing element during ordinary updates when that destroys selection, composition, undo, or scroll.
- Apply generated and programmatic edits as explicit transactions with one predictable undo step.
- A transaction records the changed range, source, operation ID, and intended selection result.
- Do not edit the document from render functions or mount effects.
- Shortcut handlers ignore incompatible composition state and controls outside the editor.
- Resolve shortcuts against the complete command registry and user settings.
- Initial HTML-to-Markdown compatibility conversion remains in PHP.
- Manage the editor instance through a focused adapter and ref; do not recreate it for ordinary React renders.

## Preview Pipeline

The production path is:

```text
Markdown
→ PreviewPort
→ POST /easymde/v1/preview
→ PHP MarkdownRenderer
→ wp_kses_post()-sanitized HTML and Feature manifest
→ local Mermaid, KaTeX, Highlight.js, and TOC enhancement
```

Rules:

- Do not add another production Markdown renderer.
- Do not show approximate fallback HTML when server rendering fails.
- Use the server-provided preview limit; do not duplicate an unversioned magic number in components.
- Abort obsolete requests with `AbortController`.
- Pair requests with an increasing ID and document/appearance signature.
- Ignore responses that are no longer current for the active post, root, document revision, or appearance.
- A previous valid preview may remain visible only with an explicit refreshing or error state.
- Enhancement failures are observable.
- Clean observers, timers, pending enhancement work, generated nodes, and Feature state on replacement or unmount.
- Load enhancement assets only when required by the server manifest.
- Reuse stored `post_content` only when PHP reports its signature is current.
- Model loading, refreshing, current, provisional, stale, error, and empty as distinct states.
- Export requires a current settled preview.

## Publishing and Taxonomy

React presents publishing; WordPress remains authoritative:

```text
React publish draft
→ PublishingPort preflight
→ synchronize native fields
→ WordPress native publish
→ observe real result
```

Rules:

- Read capabilities and native-control availability through `PublishingPort`.
- Keep unconfirmed dialog changes local.
- Opening, closing, and cancellation write nothing.
- Fail clearly when a control or capability is unavailable.
- Preserve categories, tags, excerpt, featured image, visibility, password, sticky state, schedule, status, and supported-post behavior.
- Do not create a replacement publishing endpoint.
- Do not submit before preflight and field synchronization.
- Prevent duplicate confirmation while pending.
- Preserve server validation and return focus to the owning control.
- Report success only after WordPress confirms the status.
- Taxonomy behavior depends on current post type; do not assume `post`.
- Preserve native term filters, hierarchy, and cache context.
- Preserve `easymde_category_options_cache_context`, including bypass by returning `false`.
- Preserve observable `easymde_category_options_load_failed`.
- A failed category load is not an empty successful tree.

## Revisions

- Verify current-post access before loading revisions.
- Use `RevisionPort` and existing routes.
- Keep server limits and ownership rules authoritative.
- Confirm before discarding unsaved session changes.
- Restore Markdown and appearance consistently.
- Let PHP regenerate `post_content` and the render signature.
- Prevent stale responses from replacing a newer document or dialog.
- Distinguish autosaves and manual revisions without changing WordPress semantics.
- Opening or previewing a revision does not mutate the document.
- A restore result identifies the restored revision and resulting saved baseline.
- Invalidate revision queries after a real restore or save when appropriate.

## Media

- Use `MediaPort` for the WordPress media frame and pasted-file upload.
- Preserve `upload_files` and post-specific permissions.
- Accept only server-supported local JPEG, PNG, GIF, and WebP inputs and server-provided limits.
- Cancellation changes nothing.
- Restore editor focus and selection before inserting Markdown.
- Preserve attachment identity and server-returned URLs.
- Revoke object URLs and cancel stale uploads.
- Do not upload remote provider URLs through the local media endpoint.
- Insert Markdown only after upload success and while the transaction remains current.
- Show progress only when the transport provides real progress.
- Failure leaves no placeholder Markdown, stale object URL, or fake attachment.
- Validate MIME type, extension, and server response independently.

## Themes and Custom CSS

Theme behavior remains registry-driven:

- Keep article and code themes in explicit PHP registries.
- Preserve `easymde_article_themes` and `easymde_code_themes`.
- Do not scan asset directories dynamically at runtime.
- Load only selected theme and required enhancement assets.
- Preserve the fixed Mac code-frame contract.
- Theme IDs, labels, handles, and availability come from validated server data.
- PHP normalizes unknown or removed IDs.

Custom CSS remains server-authoritative:

- The library belongs to current-user WordPress user meta.
- Create, update, and delete require `unfiltered_html`.
- `CustomCssPolicy` and current REST endpoints own parsing, normalization, scoping, blocked tokens, remote-loading rejection, size limits, and nested at-rules.
- React never implements a browser CSS parser as a security boundary.
- Preview remains temporary until explicit save.
- Remove preview style nodes on close, replacement, cancellation, or failure.
- Preserve selected custom CSS ID and post snapshot behavior.
- Published content remains stable when a library entry later changes or disappears.
- Handle duplicate names, permission denial, parser absence, unsafe CSS, conflicts, remote-loading attempts, and active-entry deletion explicitly.
- Never place raw custom CSS in diagnostics or unrelated roots.

## Settings Application

The settings screen is a separate WordPress-owned application surface.

- `manage_options` remains required.
- Options API, `register_setting()`, and PHP sanitization remain authoritative.
- React does not persist settings directly to browser storage or bypass the sanitizer.
- Preserve the versioned settings payload and valid fallback behavior.
- Shortcut options come from the complete command registry, including extensions.
- Keep shortcut normalization and conflict validation consistent with PHP.
- Invalid settings preserve the last valid stored value and show real errors.
- The settings app owns its own schema, runtime, store, root, assets, and tests.
- Settings state never imports or mutates the editor store.
- Save succeeds only after WordPress persists the sanitized option.
- Do not expose controls for unavailable capabilities or site configuration.

## Clipboard and WeChat Export

Keep rich export behind `ClipboardPort` and an explicit user gesture.

- Export only the current settled sanitized preview.
- Reject empty, pending, refreshing, provisional, stale, or failed preview.
- Clone preview DOM; never move or mutate the live preview.
- Remove scripts, styles, internal IDs, internal classes where required, live-region attributes, and enhancement bookkeeping.
- Inline only the approved computed-style allowlist.
- Produce `text/html` and `text/plain` when supported.
- Use the modern Clipboard API when available and the existing legacy path only as an explicit fallback.
- The legacy path restores selection, ranges, focus, scroll, and temporary DOM after success or failure.
- Clipboard denial and unsupported APIs are real failures.
- Export never saves, publishes, uploads, changes the document, or writes storage.
- Exclude editor controls, pending/error UI, diagnostics, and hidden metadata.

## Local Drafts

Local drafts are content recovery, not layout preferences.

- Keep them in `local-drafts` behind `StoragePort`.
- Scope keys by site, user, and post identity.
- Keep layout keys separate from content-recovery keys.
- Version every stored payload.
- Store only minimum recoverable content and timestamps.
- Never store nonces, credentials, publishing passwords, provider tokens, full custom CSS libraries, or unrelated WordPress data.
- Throttle writes and report storage failure without blocking editing.
- Never silently replace the current document; compare baselines and ask.
- Clear or advance a draft only after a real save for the same document state.
- Re-key new-post drafts safely after WordPress assigns an ID.
- Prevent an old `new` draft from attaching to another new post.
- Handle unavailable storage, quota, corrupt JSON, schema mismatch, clock anomalies, logout, and user changes.
- Recovery does not change post status or prove server persistence.

## Extension Registries

- Serialize toolbar commands and shortcode helpers through validated bootstrap contracts.
- Do not hardcode React UI to built-in commands.
- Validate IDs, surfaces, groups, actions, icons, prefixes, suffixes, levels, labels, descriptions, and shortcuts.
- Unsupported actions fail visibly or use an explicit adapter; never execute arbitrary JavaScript.
- Preserve translated labels supplied by PHP.
- Shortcut conflicts include extension commands and user settings.
- Execute commands through document transactions and focused ports.
- Keep order and ID behavior deterministic.
- Extension-shape changes require versioned PHP and TypeScript validators and compatibility tests.
- Do not expose internal services as a replacement public facade.

## Effects, Events, and Lifecycle

Every effect needs an owner, trigger, cleanup, and failure path.

Clean up:

- event listeners and subscriptions;
- observers and timers;
- animation frames;
- abort controllers;
- object URLs;
- portals and overlays;
- temporary style nodes;
- body and ancestor classes;
- inline styles and CSS variables;
- scroll locks;
- selection changes;
- pointer capture.

Rules:

- Repeated activation does not multiply handlers or retain stale state.
- Work from an old post, root, dialog, surface, or session cannot update current UI.
- Development Strict Mode and repeated mounts must not duplicate writes, mutations, subscriptions, uploads, clipboard operations, or timers.
- Setup and teardown are idempotent and cleanup is safe after partial failure.
- Prefer event handlers and commands for user actions.
- Effects synchronize external systems; they do not provide general control flow.
- Never start a mutation from an effect merely because state became truthy.
- Use stable operation IDs for long-running work.
- Deduplicate document/window listeners through one lifecycle owner or adapter.
- Use passive listeners only when the handler never calls `preventDefault()`.
- `MutationObserver` is scoped, justified by a WordPress-owned dynamic contract, and disconnected on teardown.
- DOM mutation is not an event bus.

## React 18 Performance and Loading

Keep the keystroke path small and predictable.

State and rendering:

- Update session Markdown immediately. Debounce preview and other expensive derived work, not controlled text input or native field synchronization.
- Do not parse the full document independently for preview scheduling, outline, statistics, syntax detection, dirty state, and AI context on every keystroke.
- Share pure derived results only with clear ownership and invalidation.
- Subscribe to derived slices or booleans instead of broad state objects.
- Derive state during render or selectors rather than synchronizing it through effects.
- Use lazy state initialization for expensive initial values.
- Use functional updates when the next value depends on previous state.
- Use refs for transient high-frequency values that do not affect rendering.
- Do not add `memo`, `useMemo`, or `useCallback` everywhere. Use them for measured expensive work or identity contracts that actually prevent work.
- `startTransition()` may wrap non-urgent panel, filtering, or derived-view updates. Never transition the controlled editor value, synchronous submission bridge, save/publish state, focus restoration, or accessibility-critical state.

Async work:

- Start independent authorized reads together.
- Preserve dependency order for dependent reads.
- Never start protected requests before bootstrap, capability, and identity validation.
- Abort obsolete work and reject stale completion.
- Do not use Suspense as an implicit WordPress data-fetching system. `React.lazy()` with an accessible fallback is allowed for code-split optional UI.
- Preload a local optional chunk on clear user intent such as focus or hover only when measured and when failure is handled.

Bundle behavior:

- Lazy-load Mermaid, KaTeX, Highlight.js, optional theme CSS, WeChat export, revisions, and AI only when required.
- Keep initial editor and settings entries separate.
- Import large libraries and icons from concrete modules when supported.
- Keep Feature `index.ts` narrow and explicit.
- Do not add Next.js import optimizers or framework-specific bundle tools.
- Measure per-entry initial JavaScript, CSS, optional chunks, duplicate modules, and runtime dependencies.
- Add a bundle budget only after recording a baseline and identifying what it protects.
- Inspect bundles for duplicated React, development code, full-library imports, source paths, remote assets, and unexpectedly shared optional code.

DOM and computation:

- Batch related DOM style changes through classes or one scoped update.
- Avoid repeated layout reads and writes in loops.
- Use `Map` or `Set` for repeated keyed lookups when data size justifies it.
- Do not use `content-visibility`, virtualization, or a worker on the editor, outline, revision list, or preview without measurement and keyboard, focus, search, selection, and accessibility tests.
- A worker handles only measured CPU-heavy pure work through typed versioned messages and cancellation.

Measure:

- large-document typing latency;
- preview request and enhancement latency;
- editor and settings mount time;
- dialog and toolbar interaction latency;
- memory after repeated open/close;
- listener and observer counts;
- production bundle and chunk output.

Do not trade correctness, stale-result protection, accessibility, or failure reporting for a benchmark.

## Accessibility and Interaction Contracts

Accessibility is part of each component contract.

Semantic controls:

- Use `<button>` for actions, `<a>` for navigation, and native form controls where possible.
- Do not use clickable `<div>` or `<span>` elements.
- Every interactive control has an accessible name.
- Icon-only buttons use an explicit accessible name; a tooltip is not the accessible name.
- Decorative icons use `aria-hidden="true"`.
- Preserve visible focus. Do not remove outlines without an equivalent focus-visible style.
- Color is not the only state signal.
- Validate text and non-text contrast in every interactive state.
- Test 200% zoom, text scaling, long translations, RTL, reduced motion, forced colors, and high contrast where the changed surface applies.

Forms:

- Associate labels with fields.
- Link help and errors using `aria-describedby`.
- Mark invalid fields with `aria-invalid`.
- Preserve entered values after validation or network failure.
- Focus or summarize the first actionable error without stealing focus repeatedly.
- Prevent duplicate state-changing submission while pending.
- Do not disable unrelated fields merely because one operation is pending.
- Client validation improves feedback; PHP and WordPress remain authoritative.
- Nonces and capability checks remain server-side security requirements.

Dialogs and popovers:

- Dialogs have a label, correct modal semantics, focus containment, initial focus, Escape behavior, and focus return.
- Escape and backdrop cancellation are enabled only when cancellation is safe.
- Destructive, publishing, unsaved, or in-progress dialogs must not close from an accidental backdrop click unless the written product contract explicitly permits it.
- Closing performs zero hidden writes.
- A popover does not trap focus like a modal unless it is actually modal.
- Portals own cleanup, stacking, focus return, and scroll-lock restoration.

Dynamic state:

- Loading containers use meaningful busy state when appropriate.
- Use polite status announcements for progress and success; use assertive alerts only for urgent blocking failures.
- Do not announce every keystroke, preview refresh, or rapidly changing statistic.
- Accessible labels, disabled state, visual state, and real behavior change together.
- Do not display success before the external operation succeeds.

Editor-specific interaction:

- Toolbar commands preserve editor selection and return focus.
- Keyboard shortcuts do not fire during incompatible IME composition.
- Dialog and media flows restore the intended selection before document insertion.
- Split-pane separators support pointer and keyboard operation, expose orientation and value, enforce minimum/maximum panes, and release pointer capture on cancellation or teardown.
- Dragging must not leave global cursors, selection locks, or listeners.
- Composite toolbars and menus use one documented keyboard model; do not mix tab-stop and arrow-navigation patterns accidentally.

## Styling and UI Fidelity

- Scope admin styles under a stable EasyMDE root.
- Preserve public article-theme, code-theme, rendered-content, and fixed Mac code-frame contracts.
- Do not apply broad element rules to WordPress admin.
- Do not use unrelated legacy classes as styling shortcuts.
- Avoid broad `!important`, arbitrary offsets, and child patches that hide an incorrect parent layout.
- Fix the first owning layout layer that diverges.
- Preserve DOM order when it carries reading, editing, or keyboard meaning.
- Use CSS Modules for isolated components only when the toolchain and changed Feature benefit; do not require them for every file.
- Keep public and integration selectors explicit.
- Use shared design tokens for intentional color, spacing, typography, radius, elevation, and motion.
- Keep admin tokens separate from article themes and public CSS.
- Use logical CSS properties when direction can change.
- Support `dir="rtl"` without mirroring controls whose meaning is directional.
- Define one controlled z-index scale.
- Use the existing approved icon source and local asset provenance.
- Do not import a full icon library for a few glyphs.
- Test empty, loading, disabled, hover, focus-visible, active, success, error, open, long-content, narrow, zoomed, and translated states required by the design contract.
- Preserve protected selectors and observable behavior unless the linked task changes them.

## Internationalization, RTL, Date, and Time

PHP remains the source of current author-facing translations unless the repository establishes another approved WordPress i18n bridge.

- Receive translated strings through validated bootstrap data.
- Do not hardcode user-facing English in production components.
- Include labels, placeholders, tooltips, notifications, empty states, errors, screen-reader text, confirmations, and ARIA labels.
- Use interpolation instead of concatenating fragments.
- Keep messages scoped to the owning Feature.
- Never use translated text as a key or error discriminator.
- PHP translates extension labels before serialization.
- Use WordPress locale, direction, date format, time format, and site timezone.
- Browser locale and timezone do not decide scheduled publication.
- Test at least one long-string locale and RTL for changed shared surfaces.
- Run repository i18n checks when strings change.

## AI Assistant Boundary

When AI assistance is implemented, keep it behind `AiPort` and explicit user action.

- Credentials and private endpoints remain server-side.
- Do not send article content, selections, attachments, or metadata until the user invokes a visible scoped capability.
- Represent selected context explicitly; do not silently include the whole document.
- Streaming uses an operation ID and `AbortController`; stale or cancelled output cannot update current state.
- Generated document changes are proposals with visible affected range or diff and apply through an undoable transaction after confirmation.
- AI never saves, publishes, uploads, changes settings/themes, invokes extensions, or performs privileged actions without separate confirmation.
- Do not persist prompts or responses by default.
- Treat model output as untrusted text. Never execute returned HTML, CSS, JavaScript, commands, URLs, or tool arguments.
- Tool calls use typed allowlisted actions, server authorization, visible scope, and confirmation for writes.
- AI failure must not block normal editing.

## Observability and Privacy

Failures must be diagnosable without exposing content or secrets.

- Normalize adapter failures and report stable codes through `DiagnosticsPort`.
- Separate translated user messages from developer diagnostics.
- Include Feature, operation, request ID, post ID when appropriate, contract version, and failure code.
- Omit Markdown, titles, excerpts, custom CSS, prompts, output, passwords, tokens, cookies, nonces, local paths, secret URLs, and raw responses.
- Gate verbose diagnostics behind an explicit development or administrator setting.
- Do not ship unconditional `console.log`, traces, payload dumps, or global debug objects.
- Surface dependency, manifest, bootstrap, permission, lock, native-contract, renderer, and schema failures.
- Add focused diagnostics when information is insufficient; do not add speculative fallback.
- Remote telemetry requires separate approval and privacy documentation.
- Test redaction with representative sensitive fields.

## Build Architecture

Use Vite from the root npm package.

When the corresponding tools exist, keep focused scripts such as:

```text
dev:editor
build:editor
typecheck:editor
lint:editor
test:editor
test:editor:watch
```

Add scripts only when the tool and source exist. Do not add placeholder commands.

Use dedicated output per entry:

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

- Keep TypeScript and React source under `frontend/`, never `assets/`.
- Generated manifest and asset metadata are the source of truth; PHP does not guess hashed filenames.
- Entry metadata declares exact WordPress dependencies and a reproducible version.
- Keep primary WordPress script handles stable; content-hashed chunks may change.
- External mapping covers every WordPress-provided runtime import, including JSX runtime behavior.
- Use local runtime assets only.
- Missing, stale, duplicate, or inconsistent manifest entries fail build or release.
- Production never references a Vite server, localhost, temporary path, or remote CDN.
- HMR is local-only and explicitly enabled.
- Dynamic import and CSS URLs resolve from the plugin asset base, not `/`.
- Verify chunk loading in a WordPress subdirectory and a non-default plugin URL.
- Never hardcode `/wp-content/plugins/easymde/`.
- Preserve WordPress dependencies, translations, versions, and load order.
- Target documented WordPress browsers; do not rely on an unverified modern API.
- Document dependency purpose and license.
- Keep lockfile and third-party notices current.
- Verify a clean checkout builds the required graph.
- Inspect bundles for duplicated React, prohibited source maps, development references, and unexpectedly eager optional code.

## Dependency Policy

A dependency is allowed only for a clear current responsibility.

Before adding one:

- identify the Feature and boundary it owns;
- confirm the repository does not already provide the capability;
- compare a small local implementation for a narrow need;
- verify WordPress and browser compatibility;
- inspect package and transitive size, maintenance, license, and runtime behavior;
- confirm no remote assets or telemetry;
- define testing and removal;
- update lockfile and notices.

Rules:

- Do not add a state, query, form, router, schema, animation, icon, or utility library because a generic Skill recommends it.
- Do not use two libraries for one responsibility.
- Development tools do not enter installable runtime output.
- Code-split runtime dependencies only when loading and failure are predictable.
- A library does not become an architectural owner.
- Wrap external libraries at a focused boundary when replacement, testing, or failure normalization matters.

## Testing and Architecture Enforcement

Choose tests by responsibility:

- `domain`: direct unit tests for pure rules and edge cases.
- `contracts`: schema versions, PHP/TypeScript fixture parity, error mapping, safe-value construction, and compile-time contracts.
- `integrations`: WordPress DOM, native forms, nonce updates, locks, REST, mounting, settings, storage, clipboard, diagnostics, public frontend isolation, and failure paths.
- `features`: component and hook behavior with mock runtimes.
- `app`: providers, independent stores, error boundaries, activation, server-state ownership, and composition.
- `tests/e2e`: real author and public flows using the installable ZIP.
- release tests: compiled entries present and development-only files absent.

When the frontend toolchain exists, enforce:

- strict TypeScript and `noEmit`;
- ESLint dependency direction and restricted globals;
- components cannot import WordPress adapters;
- approved React runtime imports;
- no private React runtime in production bundles;
- valid manifest entries, dependencies, CSS, and chunks;
- PHP-to-TypeScript bootstrap parity;
- REST fixtures for used routes;
- installable ZIP includes compiled runtime and excludes source.

Cover relevant negative and repeated cases:

- WordPress 6.7 and latest supported WordPress;
- `createRoot` mount and teardown;
- startup failure before and after ownership activation;
- independent editor and settings roots;
- permission denial, authentication expiry, nonce refresh, and lock loss;
- stale native fields at save and autosave;
- disabled or missing native controls;
- zero-write opening of ordinary supported posts;
- empty stored Markdown and first legitimate save;
- preview limit, renderer absence, stale responses, and provisional states;
- cancelled and failed media;
- storage denial, corrupt drafts, and new-post re-keying;
- unsafe or conflicting custom CSS;
- extension commands and shortcut conflicts;
- settings validation and preservation of valid values;
- current-preview WeChat export and rejection of pending/error preview;
- public articles without admin bundles or client Markdown authority;
- repeated mount/unmount and Strict Mode;
- focus return, Escape, selection direction, IME, undo, scroll, drag cancellation, and cleanup;
- RTL, long translations, site-timezone scheduling, and WordPress date formats;
- large content, dynamic chunks, subdirectory installation, and bundle loading;
- release completeness and privacy-safe artifacts.

Test components through semantic roles and accessible names. Test user behavior, not hook counts or private state. Do not claim validation that was not performed.

## Release Packaging

The installable plugin ZIP contains PHP production code, templates, Composer runtime dependencies, translations, local vendor assets, and required compiled browser assets.

It excludes:

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

Before changing release behavior:

- inspect `scripts/build-release.mjs` and release tests;
- build every required Vite entry;
- verify compiled assets and WordPress dependency metadata;
- confirm `.agents/` and `frontend/` are not installable paths;
- confirm Composer development packages are absent;
- confirm runtime assets, licenses, and notices;
- inspect the produced ZIP;
- search built JS and CSS for localhost, Vite client code, source paths, remote CDNs, private endpoints, full library imports, and duplicate React;
- install the ZIP into clean supported WordPress;
- exercise changed editor, settings, and public paths;
- verify dynamic chunks load from the installed plugin URL;
- confirm public pages exclude admin React entries.

## Prohibited Patterns

Do not introduce:

- Gutenberg replacement behavior, Next.js, Webpack, another frontend framework, or a replacement publishing backend without explicit approval.
- React 19-only APIs while the WordPress 6.7 React 18 runtime is authoritative.
- Next.js, RSC, server-action, hydration, or framework-specific performance patterns in the admin application.
- A bundled React runtime by accident or mixed runtimes.
- Direct WordPress DOM, jQuery, `wp.apiFetch`, `wp.media`, storage, clipboard, or bootstrap access from components.
- A browser HTML-to-Markdown authority replacing the PHP compatibility path.
- Another production Markdown renderer or browser CSS parser used as a security boundary.
- Raw string access to `dangerouslySetInnerHTML` outside the safe preview sink.
- Admin React mounted or hydrated on public rendered posts.
- A universal adapter, god component, shared root store, or unstructured component directory.
- A shared `app/store/` or `app/providers/` used by editor and settings roots.
- Feature private imports, upward imports, broad barrels, or circular dependencies.
- Boolean-prop combinations that permit impossible product states.
- Context values containing the full high-frequency document state.
- Duplicated authority across React, query state, DOM fields, storage, options, and meta.
- Two active owners for preview, shortcuts, drafts, save, publish, media, settings, clipboard, or another write.
- Silent fallback, swallowed errors, fake success, hidden writes, force-clicking disabled controls, or mutation retries.
- Stale async work updating current state.
- Effects without cleanup, idempotence, or repeated-lifecycle safety.
- Browser-local scheduling that disagrees with WordPress.
- Built-in-only command registries that break extensions.
- TypeScript source under `assets/`.
- Root-relative plugin asset URLs, hardcoded plugin URLs, remote runtime CDNs, or production development-server references.
- Placeholder modules, empty Feature directories, speculative abstractions, or unused assets.
- Private content, custom CSS, AI context, settings secrets, nonces, or credentials in diagnostics.
- Development source, tests, caches, local metadata, or secrets in the installable package.
- Blanket application of generic Skill rules that conflict with this project.

## Completion Gate

Before declaring a React Feature complete:

1. Identify the single owner for every changed behavior and state value.
2. Confirm task, `AGENTS.md`, EasyMDE Skill, and companion-Skill priority was applied correctly.
3. Confirm editor/settings root, store, provider, error-boundary, and lifecycle ownership.
4. Confirm directory placement, dependency direction, public Feature API, code naming, and no speculative files.
5. Confirm persisted meta, settings, extension, REST, and public compatibility contracts.
6. Confirm ordinary supported-post opening remains zero-write where relevant.
7. Confirm components use typed contracts and focused ports.
8. Confirm React 18 and WordPress 6.7 runtime behavior, `createRoot` teardown, and no duplicate React.
9. Confirm component variants, Context scope, selector subscriptions, and impossible states.
10. Confirm native fields, real save/publish observation, nonce refresh, lock loss, and dirty baseline.
11. Confirm permission, validation, cancellation, stale result, missing control, schema, and dependency failure.
12. Confirm Markdown, preview, revisions, media, themes, custom CSS, settings, clipboard, drafts, extensions, AI, and public frontend touched by the Feature.
13. Confirm semantic HTML, labels, forms, dialog behavior, focus, keyboard, selection, IME, undo, scroll, split-pane drag, RTL, reduced motion, contrast, and zoom where applicable.
14. Confirm performance claims use measurements and React 18-compatible techniques.
15. Run focused type, lint, unit, contract, integration, browser, i18n, performance, and release checks available for changed paths.
16. Inspect the exact diff, manifest, WordPress asset metadata, bundles, and installable ZIP.
17. Verify dynamic assets on the installed plugin URL and public exclusion of admin entries.
18. Report what was verified, what remains unverified, and every known risk without inventing evidence.
