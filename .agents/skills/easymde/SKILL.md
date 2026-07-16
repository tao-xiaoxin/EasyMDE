---
name: easymde
description: Use this skill when building, modifying, debugging, reviewing, or validating EasyMDE React and TypeScript admin-editor features or related browser-side interfaces, including WordPress integration, Markdown editing and preview, publishing, revisions, media, themes, custom CSS, settings, local state, WeChat export, AI assistance, accessibility, performance, testing, Vite builds, and release packaging.
---

# EasyMDE React and TypeScript Development Guide

EasyMDE is a standalone WordPress Markdown editor. React and TypeScript, built with Vite, are the browser-application architecture for the admin editor and related interactive WordPress administration surfaces.

This Skill is an executable project contract. It defines ownership, directory structure, dependency direction, React 18 behavior, TypeScript conventions, component APIs, WordPress integration, data and security boundaries, testing, observability, performance, and release packaging.

It is not a generic React tutorial. Do not introduce a pattern, dependency, abstraction, directory, or service merely because it is common in another React project.

## Source Authority and Evidence Policy

Use sources in this order:

1. The explicit task, linked GitHub Issue, and human maintainer decisions.
2. The live EasyMDE repository and root `AGENTS.md`.
3. `docs/ARCHITECTURE.md`, `docs/REACT_ARCHITECTURE.md`, and other current project documentation.
4. This EasyMDE Skill.
5. Official React documentation at `react.dev`.
6. Official WordPress developer documentation and the WordPress/Gutenberg source matching the supported WordPress version.
7. Official TypeScript documentation at `typescriptlang.org`.
8. Generic companion Skills and secondary articles.

Secondary articles are inspiration, not authority. Before adopting a recommendation:

- verify that it still applies to React 18 and the TypeScript version selected by the project;
- verify that it fits WordPress 6.7 or newer and the actual WordPress runtime contract;
- verify that it does not conflict with EasyMDE data, save, preview, publishing, extension, privacy, or package boundaries;
- prefer the live API and tagged source over search summaries or copied snippets;
- record uncertainty instead of converting an unverified claim into a project rule.

Generic Skills may strengthen implementation quality but cannot override EasyMDE architecture or introduce Next.js, React Server Components, Server Actions, React 19-only APIs, Webpack, Gutenberg replacement behavior, a private React runtime, another save or publish path, remote runtime assets, or an unapproved dependency.

## Project Design Philosophy

Apply these principles together.

### System requirements decide the tool

React is used because the admin UI benefits from declarative components, explicit state ownership, predictable composition, and testable interaction boundaries. React does not become the owner of WordPress data, security, rendering, persistence, or public content.

A library is justified by a concrete project responsibility, not by popularity. The smallest design that satisfies the product contract is preferred.

### Model the data and states before the component tree

Before building a screen:

1. identify the server and browser data model;
2. list the meaningful visual and interaction states;
3. identify the owner of every state value;
4. draw the component hierarchy around user-recognizable responsibilities;
5. implement a render-only version from typed inputs;
6. add interaction through explicit events, commands, ports, and state transitions.

Do not start by creating generic components, a store, or a framework wrapper before the actual model and behavior are understood.

### Rendering is pure

Components and Hooks must be pure during render:

- same props, state, and context produce the same JSX;
- render does not mutate props, state, context, registries, adapters, globals, DOM, storage, or external services;
- render does not save, publish, upload, copy, log payloads, schedule timers, or register subscriptions;
- user-triggered work belongs in event handlers or explicit commands;
- synchronization with external systems belongs in focused Effects or adapters with cleanup.

### One owner per fact

Every unique fact has one authoritative owner.

Examples:

- canonical Markdown: `_easymde_markdown` persisted by PHP;
- current editor-session Markdown: editor store;
- compatibility HTML: PHP `MarkdownRenderer` and `post_content`;
- current native form serialization: synchronized WordPress submission bridge;
- current REST security token: WordPress security owner exposed through `SessionPort`;
- dialog draft: the closest Feature component or Feature provider;
- settings persistence: WordPress Options API.

Do not duplicate a fact across local component state, Context, store, query cache, DOM fields, storage, and PHP merely to make access convenient.

### State is minimal and intentional

- Group values that form one atomic transition.
- Avoid contradictory state.
- Derive values instead of storing redundant copies.
- Avoid duplicated and deeply nested state.
- Keep state near the closest owner that coordinates all consumers.
- Lift state only when coordination requires it.
- Reset state intentionally by owner identity, not by accidental component movement or random keys.

### Boundaries must be observable

Every external operation has:

- an owner;
- typed input and output;
- permission and validation rules;
- cancellation or conflict semantics where applicable;
- a stable success signal from the real owning system;
- a user-visible failure state;
- diagnostics that do not expose content or secrets;
- tests at the lowest reliable boundary and, where required, a real browser flow.

## Inspect Before Changing

Read the live repository before choosing files or abstractions:

```text
AGENTS.md
readme.txt
package.json
docs/ARCHITECTURE.md
docs/REACT_ARCHITECTURE.md
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

Do not assume proposed frontend paths already exist. Create only files and directories required by the current Issue.

Trace the complete path before editing:

```text
PHP or WordPress state
→ versioned bootstrap or REST contract
→ application or Feature owner
→ component and user event
→ focused port
→ WordPress, REST, or browser adapter
→ real operation result
→ state transition and user feedback
```

For each changed behavior, identify:

- current and intended owner;
- persisted authority and browser-session authority;
- protected compatibility contracts;
- success and failure evidence;
- cancellation, stale completion, and teardown behavior;
- package and public-artifact impact.

## Critical Authority Rules

- `_easymde_markdown` is the canonical Markdown source.
- `post_content` is sanitized rendered HTML for WordPress compatibility.
- `EasyMDE\Content\MarkdownRenderer`, backed by `league/commonmark`, is the only production Markdown renderer.
- PHP and WordPress own permissions, capability checks, nonces, post meta, revisions, media, taxonomies, save, publish, post status, post locking, autosave, scheduling, settings persistence, public article output, and supported-post admission.
- React owns admin presentation, interaction, Feature composition, dialogs, panels, layout, and explicitly defined browser-session behavior.
- Client capability flags control presentation only; PHP verifies every protected action.
- A nonce is a request-integrity mechanism, not authorization. Every protected action still requires the correct capability check.
- Opening, closing, previewing, focusing, or cancelling UI performs zero hidden writes.
- A synchronized native field is a submission bridge, not proof of persistence.
- A resolved browser Promise is not proof of save, publish, upload, restore, settings update, or clipboard success unless it represents the real owning operation.
- React must not create a second data authority, renderer, permission system, save path, publish path, media store, revision model, settings store, timezone model, or public-content authority.

## React Runtime Strategy

EasyMDE supports WordPress 6.7 or newer and uses the WordPress-provided React 18 runtime through `@wordpress/element` and the `wp-element` dependency.

```tsx
import { createRoot } from '@wordpress/element';

export function mountEditor(element: HTMLElement): () => void {
  const root = createRoot(element);
  root.render(<EditorApp />);

  return () => root.unmount();
}
```

Rules:

- Import React runtime APIs from `@wordpress/element` by default.
- Use `createRoot`; do not add legacy `render` fallbacks.
- Keep the root object and call `root.unmount()` during teardown.
- Do not hydrate admin roots.
- Do not ship another React or ReactDOM implementation.
- Do not pass elements, contexts, hooks, portals, or refs between different React runtimes.
- Externalize or map the JSX runtime consistently and verify the production module graph.
- Declare exact WordPress dependencies in generated asset metadata.
- Do not use React 19-only APIs.
- Use `StrictMode` in development when the selected mount strategy supports it, and treat double render, Effect replay, and ref callback replay as tests of purity and cleanup rather than conditions to suppress.

Do not adopt `@wordpress/components` as a second default design system. A focused task may use a stable WordPress component only after verifying its WordPress 6.7 API, accessibility, visual behavior, dependency graph, and package cost.

## Application Roots and Directory Structure

Use one entrypoint per real WordPress screen or independently loaded application surface:

```text
frontend/src/entrypoints/admin-editor.tsx
frontend/src/entrypoints/settings.tsx
```

Each root owns its own runtime, store, providers, error boundary, subscriptions, and teardown. Editor and settings roots may share contracts, pure domain code, and UI primitives; they do not share mutable state, query caches, or lifecycle owners.

Default structure:

```text
frontend/
├── vite.config.ts
├── vitest.config.ts          # only when Vitest is introduced
├── tsconfig.json
├── eslint.config.js          # only when ESLint is introduced
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
    │   ├── editor-runtime.ts
    │   └── settings-runtime.ts
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
    │   │   ├── document/
    │   │   ├── save/
    │   │   ├── session/
    │   │   ├── publishing/
    │   │   ├── revisions/
    │   │   ├── media/
    │   │   ├── settings/
    │   │   └── rest/
    │   ├── preview-runtime/
    │   └── browser/
    │       ├── storage/
    │       ├── clipboard/
    │       └── diagnostics/
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

Do not create empty paths, a second package or lockfile, shared `app/store/`, shared `app/providers/`, or generic root `components/`, `services/`, `helpers/`, or `utils/` directories.

### Layer responsibilities

- `entrypoints/`: root discovery, bootstrap parsing, runtime and store construction, mount, readiness activation, and teardown.
- `app/editor/` and `app/settings/`: root shell, providers, error boundary, store, and top-level composition.
- `contracts/`: runtime-validated bootstrap schemas, ports, request/result types, stable error codes, safe-value brands, extension contracts, and manifest contracts.
- `domain/`: pure document, Markdown, outline, statistics, appearance, publishing, revision, and settings rules.
- `features/`: complete user-recognizable capabilities.
- `integrations/`: WordPress DOM, native forms, REST, media, preview enhancement, storage, clipboard, diagnostics, and browser adapters.
- `shared/`: reusable UI and utilities with no EasyMDE Feature or WordPress ownership.
- `test/`: shared setup and fixtures; normal tests stay beside source.

### Dependency direction

```text
entrypoints  → app, contracts, integrations
app          → features, contracts, shared
features     → domain, contracts, shared
domain       → shared pure utilities and types only
contracts    → domain types and shared types only
integrations → contracts, domain, shared
shared       → no app, Feature, integration, or WordPress ownership
```

Circular imports, upward imports, Feature-private deep imports, and concrete adapter construction inside Features are defects. Enforce dependency direction automatically when the frontend lint toolchain exists.

## Feature and Component Design

Group code by user capability:

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

Create a component when it has a clear semantic responsibility, an independent state or accessibility contract, meaningful reuse, or a testable failure boundary. Do not split every wrapper into a component, and do not keep unrelated responsibilities in a large component.

Component API rules:

- Prefer data and callbacks that express user intent rather than internal implementation details.
- Prefer explicit variants or discriminated unions when structure or behavior differs.
- Atomic booleans are acceptable for native state such as `disabled`, `required`, `readOnly`, `selected`, or `aria-expanded`.
- Avoid groups of booleans that allow impossible combinations.
- Use compound components only for a cohesive semantic control with genuinely shared scoped state.
- Prefer `children` for structural composition; use a render function only when the caller needs live internal data.
- Controlled components receive value and update callbacks; uncontrolled components own an initial value. Do not switch modes during one lifecycle.
- Shared UI primitives do not know post IDs, WordPress capabilities, selectors, routes, or EasyMDE Feature rules.
- Do not inspect child component types, clone arbitrary children, or mutate child props to build hidden protocols. Prefer explicit slots, context, or typed props.
- Error boundaries isolate independently recoverable UI regions and reset on the identity that owns the region.
- Do not add a router for tabs, dialogs, or panels. WordPress owns page navigation unless a real URL-addressable application surface is explicitly approved.

Public Feature exports are narrow and named. Never use `export *`. Other Features import only the public API; internal modules import concrete sibling files rather than their own barrel.

## TypeScript and Naming Standards

Naming defaults:

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

### Compiler baseline

When the frontend toolchain is introduced, start strict rather than scheduling type safety for later.

Required unless a verified toolchain limitation is documented:

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "useUnknownInCatchVariables": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true
  }
}
```

Evaluate `exactOptionalPropertyTypes` with the selected React and WordPress type packages. Enable it when compatible; do not disable other strictness globally to work around one dependency without evidence.

### Types and inference

- Use `unknown` at untrusted boundaries and narrow or parse once.
- Do not use `any` as a substitute for validation. A narrow documented integration shim is the only acceptable exception.
- Let TypeScript infer obvious local variables, JSX event parameters, and private helper return types.
- Add explicit return types to ports, exported APIs, schema parsers, async boundary functions, and functions whose contract must not drift.
- Use discriminated unions for operation states, results, variants, and mutually exclusive props.
- Use exhaustive switches with `assertNever()` for closed unions.
- Use `Readonly` and `ReadonlyArray` for snapshots and inputs that callers must not mutate.
- Use branded or opaque types only when runtime provenance matters, such as sanitized preview HTML or validated IDs.
- Use utility types for local transformations; do not construct long-lived domain contracts from chains of `Pick`, `Omit`, and intersections that hide their semantics.
- Use `satisfies` for registries, configuration maps, and fixtures when the value should retain useful literal inference while being checked against a contract.
- Avoid non-null assertions. Validate once, narrow, and pass the narrowed value.

### `type` and `interface`

Both are valid TypeScript object-type tools. Use a project convention based on intent:

- use `type` for closed component props, unions, tuples, aliases, mapped types, and Feature-local models;
- use `interface` for intentionally extensible object contracts such as Ports or public adapter surfaces;
- do not rely on declaration merging unless extension is an explicit supported contract;
- consistency and contract clarity matter more than stylistic preference.

### Function components and Props

Use ordinary function components with explicit Props. Do not use `React.FC` as the default.

```tsx
type ButtonProps = {
  variant: 'primary' | 'ghost';
  children: React.ReactNode;
  onPress(): void;
};

export function Button({ variant, children, onPress }: ButtonProps) {
  return (
    <button type="button" data-variant={variant} onClick={onPress}>
      {children}
    </button>
  );
}
```

The project convention is not based on the outdated claim that modern `React.FC` always injects `children`. It is chosen because ordinary functions keep Props explicit, work naturally with generics, and avoid unnecessary component-type wrapping.

Declare `children` only when the component accepts children. Use `React.ReactNode` for general renderable children. Use a typed function when the child is intentionally a render callback.

### Native element props

A reusable primitive may extend native semantics:

```tsx
type IconButtonProps = Omit<
  React.ComponentPropsWithoutRef<'button'>,
  'children'
> & {
  label: string;
  icon: React.ReactNode;
};
```

Rules:

- preserve the native element's semantic attributes and event types;
- resolve prop-name collisions explicitly with `Omit`;
- set safe defaults such as `type="button"` inside forms;
- do not blindly spread DOM props onto a non-native wrapper or multiple elements;
- keep project variants separate from native attributes.

### Events, state, refs, and Hooks

- Prefer contextual typing by declaring handlers where TypeScript can infer the element event type.
- Export a named event-handler type only when it is part of a component contract.
- Never type React events as `any`.
- Let `useState` infer clear primitive/object initial values.
- Add an explicit generic for `null`, `undefined`, empty arrays, empty maps, or intentional unions.
- Use `useRef<HTMLInputElement>(null)` for DOM refs.
- Use `useRef<T | null>(null)` for mutable non-render values when `current` must be assigned.
- A ref is not a substitute for render state or a second document authority.
- Custom Hooks share stateful logic, not state instances. Shared state still needs an explicit owner.
- Name Hooks for a concrete purpose, not lifecycle timing; avoid generic APIs such as `useMount`.
- Return objects from Hooks when named fields improve evolution and readability.
- Return tuples only for a stable positional API; annotate the tuple or use `as const`.
- Generic components require a real reusable semantic contract. Do not create generic List/Table/Form abstractions before at least two concrete needs prove the shared API.

### Comments and formatting

- Let the adopted formatter and linter own whitespace, quotes, semicolons, and wrapping.
- Match the nearest maintained code until those tools exist.
- Comments explain ownership, security, compatibility, invariants, or non-obvious failure behavior; they do not narrate JSX.
- Do not suppress type, lint, accessibility, Hook-dependency, or boundary errors without a narrow documented reason and a focused test.

## State Ownership and Identity

Use one store per application root. Do not export a mutable module-level singleton.

Suggested editor responsibilities:

```text
document    # Markdown, title, saved baseline, dirty state, selection metadata
appearance  # article theme, code theme, fonts, custom CSS selection
layout      # view mode, pane ratio, outline, open panels
session     # operations, errors, active surface, capabilities, post identity, lock state
```

Rules:

- Keep ephemeral input, hover, unconfirmed dialog fields, local validation display, and temporary drag state in the nearest component.
- Put state shared by multiple Features in the owning root store.
- Keep REST-backed collections in one server-state owner with explicit invalidation.
- Derive dirty state and other facts; do not store duplicate flags.
- Do not mirror React state through Effects.
- Do not duplicate the same fact in Context, store, query cache, DOM fields, and storage.
- Update the saved baseline only after the real WordPress save succeeds.
- Scope post state, caches, operation IDs, and storage keys by site, user, and post identity.
- When a new post receives a real ID, explicitly re-key or clear post-scoped state.
- Use stable domain identity as React keys. Never use random keys or array indexes for reorderable domain data.
- A key may intentionally reset a subtree when the owning entity changes; document that reset contract.
- Do not define component functions inside render when doing so would reset their state on every parent render.
- Persist only approved browser preferences or recovery data with a versioned schema and documented conflict behavior.

## Events, Effects, Refs, and Lifecycle

Use event handlers for actions caused by a specific user interaction. Use Effects only to synchronize with an external system after render.

Do not use Effects to:

- calculate renderable derived data;
- copy props into state;
- mirror one store value into another;
- trigger a mutation merely because a boolean became true;
- process a button click indirectly;
- initialize data that can be created through lazy state initialization;
- reset state when a stable key or explicit event can express the owner change.

Every Effect has:

- a single external synchronization responsibility;
- explicit reactive dependencies;
- setup and idempotent cleanup;
- a failure path;
- tests for repeated mount and partial initialization where the effect is material.

Clean up listeners, subscriptions, observers, timers, animation frames, abort controllers, object URLs, portals, overlays, temporary nodes, classes, inline styles, CSS variables, scroll locks, selection changes, and pointer capture.

Strict Mode and repeated activation must not duplicate writes, uploads, clipboard actions, subscriptions, timers, or native handlers.

## Runtime Ports and Interface Design

Features depend on focused capabilities rather than WordPress globals or selectors:

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
  readNativeSnapshot(): Readonly<NativeDocumentSnapshot>;
  synchronizeSubmissionBridge(
    snapshot: Readonly<DocumentSubmissionSnapshot>,
  ): void;
  applyEditorTransaction(
    transaction: Readonly<DocumentTransaction>,
  ): DocumentTransactionResult;
}

export interface SavePort {
  request(
    request: Readonly<{ kind: 'draft' | 'update'; operationId: string }>,
  ): Promise<SaveResult>;
  subscribe(listener: (event: SaveEvent) => void): () => void;
}

export interface SessionPort {
  getSnapshot(): Readonly<SessionSnapshot>;
  subscribe(listener: (event: SessionEvent) => void): () => void;
}

export interface PreviewPort {
  render(
    input: Readonly<PreviewRequest>,
    options: Readonly<{ signal: AbortSignal; requestId: number }>,
  ): Promise<PreviewResult>;
}
```

Interface philosophy:

- Name methods by project intent, not transport verbs such as generic `request()` or `execute(type, payload)` when a clearer capability exists.
- Keep Commands and Queries conceptually distinct.
- Prefer one options object when a function has multiple related parameters or is expected to evolve.
- Avoid boolean parameters; use named options or discriminated unions.
- Return immutable snapshots, not mutable internal references.
- Represent expected cancellation, validation, conflict, permission, and unavailable states with typed results.
- Reserve thrown exceptions for programmer defects or unexpected infrastructure failures that cannot be represented normally.
- Preserve stable server error codes and HTTP status separately from translated user messages.
- Accept `AbortSignal` for cancellable asynchronous work.
- Every subscription returns an idempotent unsubscribe function.
- A port represents one external-system responsibility. Do not grow a universal `EditorAdapter`, `WordPressService`, or generic event bus.
- Do not expose a concrete store, REST client, DOM node, or WordPress global through a public Port.
- Test adapters against Port contracts and Features against mock Ports.

Only entrypoints and relevant integrations may know `window.EasyMDEConfig`, `window.wp`, `wp.apiFetch`, jQuery, WordPress selectors, native save/publish controls, `wp.media`, browser storage, clipboard APIs, or legacy `execCommand` fallback.

## Bootstrap, REST, and Cross-Language Contracts

TypeScript interfaces do not validate PHP, REST, storage, manifests, or extension data. Parse external values at the boundary.

Use versioned runtime schemas for:

- editor and settings bootstrap data;
- REST requests and responses;
- extension commands and shortcode helpers;
- persisted browser-storage payloads;
- build manifests and WordPress asset metadata.

Rules:

- Validate required fields before mounting or executing a protected operation.
- Unknown optional fields may be ignored; an unknown incompatible version fails clearly.
- Increment a version when old consumers cannot safely interpret the new payload.
- Never change a field's meaning in place.
- Keep endpoint URLs, limits, locale, direction, site timezone, storage identity, and Feature availability in the owning contract.
- Do not serialize credentials, cookies, private configuration, unrelated user data, or article content not required by the screen.
- Components never read global bootstrap data directly.
- Add cross-language fixtures that serialize representative PHP payloads and parse them with the TypeScript runtime schema.
- If the project later adopts OpenAPI, generated schema types may become one source; do not add OpenAPI, GraphQL code generation, tRPC, or a schema library merely to follow a generic recommendation.
- The current WordPress REST route schema and versioned project fixtures remain authoritative until a deliberate replacement is approved.

REST rules:

- Every protected route has a `permission_callback` that checks the capability required for the specific action.
- Authentication or a valid nonce does not replace authorization.
- Prefer precise validation; sanitize when precise validation is not possible.
- Return data, `WP_REST_Response`, or `WP_Error`; do not manually emit JSON from REST callbacks.
- The client uses validated same-origin endpoints and the current WordPress-owned nonce.
- Use `@wordpress/api-fetch` only inside the REST integration; its nonce middleware may be updated when WordPress provides a fresh nonce.
- Pass `AbortSignal` for cancellable reads.
- Normalize `WP_Error`, HTTP failures, malformed JSON, network errors, timeouts, and aborts into typed results.
- Retry only bounded, idempotent reads. Never automatically retry save, publish, delete, settings updates, uploads, CSS writes, or revision restores.
- Do not branch on translated messages or expose raw response HTML to users.

## Persisted Data and Compatibility

Protected post meta:

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

- Never rename, remove, reinterpret, eagerly initialize, or silently invalidate an existing field without an explicit compatibility plan and tests.
- `_easymde_enabled` describes stored document state; it does not decide editor admission.
- `easymde_supported_post_types` and `PostModeController` own admission.
- Opening an ordinary supported post imports compatibility content in memory through the existing PHP path and performs zero writes.
- Do not add a browser HTML-to-Markdown authority for initial loading.
- Empty stored Markdown is valid; preserve `metadata_exists()` semantics.
- The next legitimate save writes canonical Markdown and appearance and synchronizes `post_content`.
- `_easymde_render_signature` is an internal consistency marker regenerated by PHP.
- Revisions restore Markdown and appearance together and let PHP regenerate compatibility HTML.
- Historical `_easymde_code_mac_style` and `codeMacStyle` values remain inactive historical data.

Preserve existing facade methods, filters, routes, script handles, extension registries, stable IDs, ordering, collision semantics, DOM bridge names, and observable behavior unless the linked Issue explicitly changes them.

## Native Form, Save, Autosave, Lock, and Nonce Bridge

The existing WordPress form remains the article submission contract.

```text
PHP initial state
→ validated bootstrap
→ root store
→ user transaction
→ synchronous native submission bridge
→ WordPress native save or publish
→ PHP persists Markdown and compatibility HTML
→ adapter observes the real result
→ store advances the saved baseline
```

Rules:

- Synchronize Markdown and appearance fields immediately after an accepted transaction or before native serialization.
- Do not leave a debounce window where save, autosave, unload checks, or native observers see stale fields.
- Dispatch only the exact native events required by the owning integration.
- React does not generate or validate the PHP save nonce.
- Autosave or revision activity is not automatically a canonical EasyMDE save.
- Keep React dirty state and WordPress form dirty state aligned to one saved baseline.
- Avoid duplicate unload prompts and submissions.
- Observe real navigation, redirect, native status, or server confirmation before reporting success.
- A disabled, missing, replaced, or extension-modified native control is a preflight failure; never force-click it.
- Preserve Heartbeat, post locks, current nonce, authentication state, and lock dialogs.
- Do not store the REST nonce as an immutable application constant.
- On invalid nonce or authentication expiry, stop the operation and enter an explicit security state; do not repeat the write with the same token.
- If the lock or capability is lost, stop mutations, cancel pending work, retain unsaved content, and explain the condition.
- Scheduling uses WordPress site timezone and native fields.

## Preview and Safe HTML

Production flow:

```text
Markdown
→ PreviewPort
→ POST /easymde/v1/preview
→ PreviewController validates request and permission
→ MarkdownRenderer generates sanitized HTML
→ MarkdownFeatureDetector detects enhancement features
→ PreviewController returns { html, features }
→ React preview surface
→ local Mermaid, KaTeX, Highlight.js, and TOC enhancement
```

`MarkdownRenderer` does not own the Feature manifest. `PreviewController` combines renderer output with `MarkdownFeatureDetector` results.

Use a branded safe value for accepted preview HTML and one preview-owned HTML sink. Markdown, AI output, error HTML, arbitrary REST values, custom CSS, extension data, and storage values never enter that sink directly.

Preview requests support Abort, request identity, stale-result rejection, payload limits, and explicit failure states. Enhancement failure preserves sanitized HTML. Cleanup removes generated nodes, observers, temporary assets, and listeners.

Never introduce another formal Markdown renderer or a silent approximate fallback.

## Feature-Specific Boundaries

### Markdown editing

- Preserve selection start, end, and direction; IME composition; undo/redo; focus; scroll; clipboard; and keyboard shortcuts.
- Do not recreate the editor instance for normal React renders.
- Apply generated edits as explicit transactions with predictable undo behavior and intended selection.
- Do not edit the document from render or mount Effects.
- Resolve shortcuts against built-in and extension command registries.

### Publishing

- React owns a temporary Publish Draft; WordPress owns real publish fields and the final operation.
- Preflight checks the real native contract and current capabilities.
- Cancellation performs zero writes.
- Success is reported only after the real WordPress publish result.

### Revisions

- WordPress owns revision identity and persistence.
- Restore Markdown and appearance together and let PHP regenerate compatibility HTML.
- Do not create a second revision store or restore through browser-only state.

### Media

- Use `MediaPort` for WordPress media library and uploads.
- Cancellation is zero-write.
- Insert Markdown only after upload success and while the originating transaction remains current.
- Restore selection and focus, revoke object URLs, and remove failed placeholders.

### Themes and custom CSS

- Theme choices come from PHP registries.
- PHP `CustomCssPolicy` owns permissions, parsing, selector scope, blocked tokens, remote loading, size limits, and nested at-rule policy.
- Browser preview is not a second security parser.

### Settings

- Settings use a separate root and store.
- `manage_options`, Options API, `register_setting()`, and PHP sanitization remain authoritative.
- Report success only after WordPress persists the sanitized option.

### Local drafts

- A local draft is recovery data, not a WordPress save.
- Keys include site, user, and post identity; payloads have a version.
- Do not persist nonces, credentials, provider tokens, or hidden server configuration.
- Do not silently overwrite a newer server document.

### WeChat export

- Copy only the current successful, stable, sanitized preview.
- Clipboard rejection is a real failure.
- Legacy fallback restores selection, range, focus, scroll, and temporary DOM.

### AI assistant

- Keep AI behind `AiPort` and explicit user action.
- Credentials and private endpoints remain server-side.
- Context scope is visible and minimal.
- Streaming is cancellable and stale-safe.
- Generated changes are visible, rejectable, and undoable document transactions.
- AI does not automatically save, publish, upload, alter settings, or execute returned HTML, CSS, JavaScript, commands, URLs, or tool arguments.

## Accessibility and UI Contracts

Accessibility is part of the component API:

- use native semantic controls;
- every control has an accessible name;
- icon-only buttons have an explicit label;
- decorative icons are hidden from assistive technology;
- preserve visible focus;
- color is not the only state signal;
- associate labels, help, and errors with form fields;
- preserve entered values after validation or network failure;
- prevent only duplicate state-changing actions while pending;
- dialogs provide labeling, focus containment, safe Escape behavior, and focus return;
- destructive, publishing, unsaved, or in-progress dialogs do not close by accidental backdrop click unless the product contract allows it;
- toolbar commands preserve selection and restore focus;
- shortcuts respect IME composition;
- split panes support pointer and keyboard operation and release capture during cancellation or teardown;
- test zoom, text scaling, long translations, RTL, reduced motion, forced colors, and high contrast where applicable.

Scope admin CSS under a stable EasyMDE root. Do not apply broad WordPress admin element rules, use unrelated legacy classes as shortcuts, or hide an incorrect parent layout with arbitrary offsets and broad `!important`.

Use project design tokens, logical properties, a controlled z-index scale, approved local icons, and deterministic UI states. Keep admin tokens separate from public article themes and CSS.

## React 18 Performance and Bundle Quality

Keep the keystroke path small and predictable:

- update session Markdown immediately;
- debounce preview and expensive derived work, not controlled input or the native submission bridge;
- subscribe to the smallest state slice;
- derive values during render or in pure selectors;
- do not parse the entire document separately for each Feature on every keystroke;
- lazy-initialize expensive local state;
- use functional updates when the next value depends on the previous value;
- use refs only for transient values that do not affect rendering;
- do not add `memo`, `useMemo`, or `useCallback` everywhere;
- optimize only after measurement or when identity is an explicit API contract;
- do not use `startTransition()` for the editor value, submission bridge, save/publish state, focus restoration, or accessibility-critical state;
- use `React.lazy()` only for optional heavy UI with an accessible fallback;
- do not use Suspense as an implicit WordPress data layer.

Start independent authorized reads together; preserve order for dependent reads and mutations. Abort obsolete work and reject stale completion.

Measure large-document typing latency, preview latency, mount time, dialog and toolbar interaction, repeated open/close memory, listener counts, and production bundle output.

Do not trade correctness, accessibility, stale-result protection, or failure reporting for a benchmark.

## Build Architecture and Dependencies

Use Vite from the root npm package. Source belongs under `frontend/`; compiled runtime belongs under `assets/build/`.

The first build implementation must choose and validate one coherent loading strategy:

- classic WordPress scripts with a compatible single-bundle or explicitly managed local optional-asset strategy; or
- WordPress Script Modules/ESM when the supported API and dependency graph are verified.

Do not claim both IIFE output and Rollup dynamic chunks without a working loading contract.

For every strategy:

- use the WordPress-provided React runtime;
- externalize or map `react`, `react-dom`, `@wordpress/element`, and the selected JSX runtime correctly;
- generate manifest and dependency metadata;
- keep primary WordPress handles stable;
- allow content-hashed chunks only when the manifest-backed loader supports them;
- resolve dynamic assets from the plugin asset base, never `/`;
- do not hardcode `/wp-content/plugins/easymde/`;
- verify subdirectory, multisite, and non-default plugin URL behavior where relevant;
- use local runtime assets only;
- fail build or release for missing, stale, duplicate, or inconsistent manifest entries;
- fail if any production entry or chunk contains a private React implementation;
- exclude dev-server URLs, localhost, source paths, prohibited source maps, remote CDN references, and development code.

A dependency requires a current responsibility, non-duplicative purpose, compatible license, acceptable direct and transitive size, active maintenance, no prohibited telemetry or remote assets, tests, removal strategy, lockfile update, and third-party notice update.

Do not add a state, query, form, router, schema, animation, icon, or utility library because a blog or generic Skill recommends it.

## Testing, Release, and Maintenance

Choose tests by responsibility:

- `domain`: pure rules and edge cases;
- `contracts`: schema versions, PHP/TypeScript fixture parity, error mapping, and safe values;
- `integrations`: WordPress DOM, native forms, nonce refresh, locks, REST, media, storage, clipboard, mounting, and failure paths;
- `features`: component and Hook behavior through mock runtimes;
- `app`: providers, independent stores, error boundaries, activation, and composition;
- E2E: real WordPress behavior using the installable ZIP;
- release tests: required compiled entries present and development files absent.

Enforce when the toolchain exists:

- strict TypeScript and `noEmit`;
- Hook and accessibility lint rules;
- dependency direction and restricted globals;
- no component imports from WordPress adapters;
- approved React runtime imports;
- valid manifest, dependency metadata, CSS, and chunks;
- PHP-to-TypeScript contract parity;
- installable ZIP includes compiled runtime and excludes source.

The installable ZIP excludes:

```text
.agents/
frontend/
node_modules/
tests/
coverage/
Playwright output
TypeScript and React source
source maps unless explicitly approved
Vite caches
local logs and configuration
development-server metadata
unrelated development files
```

Maintainability rules:

- Prefer a clear duplicated three-line local implementation over a premature abstraction with unclear ownership.
- Extract shared code after a stable repeated responsibility is proven.
- Keep public contracts small and versioned; keep concrete implementation private.
- Deprecate before removing a public extension boundary.
- Record material architecture decisions and why simpler alternatives were insufficient.
- Update `docs/REACT_ARCHITECTURE.md` and this Skill together when a durable rule changes.
- Do not preserve obsolete rules merely because they were once documented.
- Do not claim tests, review, performance, accessibility, or browser validation that was not actually performed.

## Prohibited Patterns

Do not introduce:

1. Gutenberg replacement, Next.js, Webpack, another frontend framework, or replacement publishing backend.
2. React 19-only APIs, private React runtime, hydration, RSC, or Server Actions.
3. A browser formal Markdown renderer or CSS security parser.
4. A second canonical document, save, publish, revision, media, settings, timezone, or public-content authority.
5. Components that directly access WordPress DOM, jQuery, `wp.apiFetch`, `wp.media`, storage, clipboard, or global bootstrap.
6. Universal adapters, generic `execute(type, payload)` APIs, God components, shared mutable root stores, or stringly typed event buses.
7. Circular dependencies, upward imports, broad barrels, Feature-private deep imports, or speculative abstraction layers.
8. Render-time side effects, Effect-driven user commands, mirrored state, duplicated authority, or impossible boolean-prop combinations.
9. Random keys, index keys for reorderable domain data, or accidental state resets through nested component definitions.
10. Silent fallback, swallowed errors, fake success, hidden writes, force-clicked disabled controls, or automatic mutation retries.
11. Stale asynchronous work updating the current post, root, dialog, or session.
12. Effects without cleanup, idempotence, failure handling, and repeated-lifecycle safety.
13. Browser-local scheduling overriding WordPress site timezone.
14. Implementations that ignore extension registries or only support built-in commands.
15. Root-relative plugin asset URLs, remote runtime CDNs, production dev-server references, or telemetry without approval.
16. Empty Feature directories, placeholder modules, unused assets, or dependencies without a current owner.
17. Private article content, custom CSS, prompts, tokens, nonces, credentials, or secret endpoints in diagnostics.
18. Source, tests, caches, logs, `.agents/`, or development metadata in the installable ZIP.
19. A generic recommendation treated as stronger than EasyMDE project evidence.

## Completion Evidence

Before reporting a React or TypeScript Feature complete, verify the parts relevant to its scope:

1. Each state and behavior has one owner.
2. Component hierarchy follows the data model and user-recognizable responsibilities.
3. Render functions and Hooks are pure.
4. State is minimal, non-duplicated, and reset intentionally by identity.
5. Directory placement and dependency direction are correct.
6. Component Props, events, refs, Hook APIs, and public exports follow the TypeScript conventions.
7. External values are runtime-validated.
8. Components use focused Ports and do not access WordPress or browser globals directly.
9. PHP and WordPress capability, nonce, validation, sanitization, escaping, save, publish, lock, and data authority remain intact.
10. Native fields, real save/publish observation, stale-result rejection, cancellation, and teardown are tested.
11. Accessibility, focus, keyboard, IME, selection, undo, scroll, RTL, zoom, and relevant visual states are covered.
12. Performance conclusions have measurements.
13. Build metadata, runtime externalization, asset URLs, local assets, and package exclusions are verified.
14. Exact diff, tests, CI, review findings, unverified areas, and remaining risks are reported honestly.
