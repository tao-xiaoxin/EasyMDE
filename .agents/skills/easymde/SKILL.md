---
name: easymde
description: Use this Skill when building, modifying, debugging, reviewing, or validating EasyMDE React and TypeScript admin-editor features or related browser-side interfaces, including WordPress integration, Markdown editing and preview, publishing, revisions, media, themes, custom CSS, settings, local drafts, WeChat export, AI assistance, accessibility, performance, Vite builds, testing, and release packaging. Use the separate easymde-migration Skill when a task transfers ownership from legacy JavaScript to React.
---

# EasyMDE React and TypeScript Development Guide

EasyMDE is a standalone WordPress Markdown editor. React and TypeScript, built with Vite, are the approved browser-application architecture for the admin editor and related interactive WordPress administration surfaces.

This Skill is the executable development contract. The durable rationale lives in `docs/REACT_DESIGN_PHILOSOPHY.md`. When a task replaces an existing JavaScript or DOM-driven owner, also load `.agents/skills/easymde-migration/SKILL.md`.

Do not introduce a pattern, dependency, abstraction, directory, service, or framework merely because it is common in another React project.

## Rule Priority and Evidence

Apply rules in this order:

1. The explicit task, linked GitHub Issue, and human maintainer decision.
2. Root `AGENTS.md`, the live repository, and existing public compatibility contracts.
3. `docs/ARCHITECTURE.md` and `docs/REACT_DESIGN_PHILOSOPHY.md`.
4. This Skill; migration work also uses `easymde-migration`.
5. Official React, WordPress, TypeScript, and WAI-ARIA documentation matching supported versions.
6. Generic companion Skills that are actually available.
7. react-admin and other mature projects as design references.
8. Blogs, search summaries, and copied snippets.

Secondary sources are inspiration, not authority. Verify version-sensitive claims against WordPress 6.7 source, the selected TypeScript version, and the live repository. Current React documentation may describe React 19; EasyMDE uses the WordPress-provided React 18 runtime.

Do not claim a Skill, test, review, browser, accessibility, security, performance, or release result that was not actually available or executed.

## Route the Task Correctly

Use this Skill for normal React and TypeScript work with one stable owner.

Also use `easymde-migration` when the task:

- transfers behavior from `assets/js/admin/` or another legacy owner;
- introduces a temporary seam used by legacy and React code;
- activates a new React owner;
- deprecates or removes a legacy module, selector, event, script handle, CSS owner, or compatibility shim.

Do not turn ordinary feature work into a migration project, and do not use migration wording to justify unrelated redesign.

## Start With the Live Contract

Before editing, inspect the actual owners relevant to the task:

```text
AGENTS.md
docs/ARCHITECTURE.md
docs/REACT_DESIGN_PHILOSOPHY.md
package.json
scripts/build-release.mjs
src/Admin/
src/Content/
src/Rest/
src/Theme/
src/Frontend/
src/Support/
templates/admin/
assets/js/admin/
assets/css/admin/
tests/
```

Do not assume a proposed `frontend/` path exists. Create only files and directories required by the linked Issue.

For every material behavior, identify:

```text
User goal:
Current owner:
Intended owner:
Persisted authority:
Browser-session authority:
WordPress/native dependencies:
Public or extension contracts:
Success signal:
Failure signal:
Cancellation and stale-result behavior:
Teardown behavior:
Package impact:
Unverified areas:
```

Trace the complete path before choosing an abstraction:

```text
PHP / WordPress state
→ versioned bootstrap or REST contract
→ root or Feature owner
→ component and user event
→ focused Port
→ WordPress / REST / browser Adapter
→ real operation result
→ state transition and user feedback
```

## Non-Negotiable Authority Rules

- `_easymde_markdown` is the authoritative Markdown source.
- `post_content` is safely rendered WordPress compatibility output.
- `EasyMDE\Content\MarkdownRenderer`, backed by `league/commonmark`, is the only formal production Markdown renderer.
- PHP and WordPress own capability checks, nonces, post meta, revisions, media, taxonomies, save, publish, status, locks, autosave, scheduling, settings persistence, public output, and supported-post admission.
- React owns admin presentation, interaction, Feature composition, dialogs, panels, layout, and explicitly defined browser-session state.
- Client capability flags control presentation only; PHP authorizes protected actions.
- A nonce protects request integrity and does not replace authorization.
- Opening, closing, focusing, previewing, or cancelling UI performs zero hidden writes.
- Native field synchronization is a submission bridge, not proof of persistence.
- A browser Promise is not success unless it represents the real WordPress or browser owner completing the operation.
- React must not create a second data authority, renderer, permission system, save path, publish path, revision model, media store, settings store, timezone model, or public-content authority.
- Public visitor pages remain PHP-rendered and do not load admin React applications.

## Use Existing Capabilities Before Creating New Ones

Adopt the useful react-admin principle of checking stable capabilities before building custom infrastructure.

Search first for an existing:

- Port or Adapter;
- Feature public API;
- Domain function;
- UI primitive;
- Theme or Toolbar Registry;
- WordPress API;
- REST controller;
- compatibility facade;
- test fixture;
- build or release helper.

Reuse only when ownership and semantics match. Do not force an unrelated abstraction to absorb a new responsibility merely to reduce file count.

A new abstraction must state its responsibility, consumers, failure contract, test boundary, and removal or replacement path.

## React Runtime and Application Roots

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

- import runtime APIs from `@wordpress/element`;
- use `createRoot`, not the deprecated legacy `render` path;
- keep the root object and call `root.unmount()` during teardown;
- do not hydrate admin roots;
- do not bundle another React or ReactDOM implementation;
- do not pass elements, contexts, hooks, portals, or refs between different React runtimes;
- externalize or map the selected JSX runtime consistently;
- generate accurate WordPress dependency metadata;
- do not use React 19-only APIs, RSC, Server Actions, or framework hydration assumptions;
- treat Strict Mode replay as a test of purity and cleanup, not a condition to suppress.

Use one Entrypoint per real WordPress screen or independently loaded application surface:

```text
frontend/src/entrypoints/admin-editor.tsx
frontend/src/entrypoints/settings.tsx
```

Each Root owns its Runtime, Store, Providers, Error Boundary, subscriptions, and teardown. Editor and Settings Roots do not share mutable state or lifecycle owners.

Do not add a Router for tabs, dialogs, panels, or WordPress page navigation unless a focused Issue proves a real URL-addressable application need.

## Source Placement

Target structure:

```text
frontend/
├── vite.config.ts
├── vitest.config.ts             # only when introduced
├── tsconfig.json
├── eslint.config.js             # only when introduced
└── src/
    ├── entrypoints/
    ├── app/
    │   ├── editor/
    │   └── settings/
    ├── contracts/
    │   ├── bootstrap/
    │   ├── ports/
    │   ├── schemas/
    │   └── errors/
    ├── domain/
    ├── features/
    ├── integrations/
    │   ├── wordpress/
    │   ├── preview-runtime/
    │   └── browser/
    ├── shared/
    │   ├── ui/
    │   ├── hooks/
    │   ├── icons/
    │   ├── i18n/
    │   └── types/
    └── test/
```

Layer rules:

- `entrypoints/`: discover Roots, parse bootstrap, construct Runtime and Store, mount, signal readiness, and teardown.
- `app/`: Root shell, Providers, Error Boundary, Store, layout, and top-level composition.
- `contracts/`: runtime schemas, Ports, Results, Error Codes, safe-value types, extension and Manifest contracts.
- `domain/`: pure rules with no React, DOM, WordPress, network, Storage, or Clipboard access.
- `features/`: complete user-recognizable capabilities.
- `integrations/`: concrete WordPress, REST, DOM, Media, preview enhancement, Storage, Clipboard, and diagnostics Adapters.
- `shared/`: code with at least two stable consumers and no Feature or WordPress ownership.
- `test/`: shared setup and fixtures; ordinary tests stay beside source.

Dependency direction:

```text
entrypoints  → app, contracts, integrations
app          → features, contracts, shared
features     → domain, contracts, shared
domain       → shared pure types/utilities only
contracts    → domain types and shared types only
integrations → contracts, domain, shared
shared       → no app, feature, integration, or WordPress ownership
```

Do not create empty paths, a second package or lockfile, shared mutable `app/store/`, or generic root `components/`, `services/`, `helpers/`, `utils/`, or `lib/` directories.

Circular imports, upward imports, Feature-private deep imports, and concrete Adapter construction inside Features are defects.

## Feature Design and Composition

Group code by user capability, not technical type:

```text
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

A complex Feature may use:

```text
features/publishing/
├── ui/
│   ├── PublishingDialog.tsx
│   └── PublishingActions.tsx
├── controller/
│   └── usePublishingController.ts
├── model/
│   ├── publishing-reducer.ts
│   ├── publishing-selectors.ts
│   └── publishing-state.ts
├── styles/
│   └── publishing.css
├── publishing.types.ts
└── index.ts
```

Do not create every subdirectory for every Feature.

Create a component when it has a clear semantic responsibility, independent state or accessibility contract, meaningful reuse, or a testable failure boundary. Do not split every wrapper into a component, and do not keep unrelated responsibilities in a large component.

Component API rules:

- prefer Props and callbacks that express user intent;
- use explicit variants or discriminated unions when structure or behavior differs;
- keep native atomic booleans such as `disabled`, `required`, and `readOnly` when they express one real state;
- avoid boolean groups that allow impossible combinations;
- use Compound Components only for one cohesive semantic control with genuinely shared scoped state;
- prefer `children` or named Slots for structural composition;
- use a render function only when the caller needs live internal data;
- keep Controlled and Uncontrolled ownership explicit and never switch modes during one lifecycle;
- do not inspect child types, clone arbitrary children, or mutate child Props to build hidden protocols;
- Shared UI does not know Post IDs, capabilities, routes, selectors, or Feature rules;
- Error Boundaries isolate independently recoverable regions and reset on the owning identity.

Borrow react-admin's Headless Controller idea only for complex Features that need replaceable Views or independent behavior testing:

```ts
type PublishingController = Readonly<{
  state: PublishingState;
  actions: PublishingActions;
  meta: PublishingMeta;
}>;
```

`state` is renderable state, `actions` are user intents, and `meta` contains derived capability, pending, or conflict information. Do not expose raw REST responses, Store setters, or concrete Adapters to the View.

Context rules:

- serve one semantic subtree;
- expose narrow named Hooks;
- do not place the entire Markdown document, high-frequency Selection, or whole Root Store in broad Context;
- do not create Context merely to avoid two levels of Props;
- do not hide a Mutation owner behind Context;
- keep Provider values stable and use narrow selectors.

Feature exports are narrow and named. Do not use broad `export *`. Other Features import only the public API.

## TypeScript and Naming Standards

Use strict TypeScript from the first frontend toolchain.

Required unless a verified limitation is documented:

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

Evaluate `exactOptionalPropertyTypes` with the selected React and WordPress type packages and enable it when compatible.

Naming defaults:

```text
Directories             kebab-case
React components        PascalCase.tsx
Error boundaries        PascalCase.tsx
Hooks                    useFeatureName.ts
Controller hooks         useFeatureNameController.ts
Other TS modules         kebab-case.ts
Port files               capability-port.ts
Adapter files            platform-capability-adapter.ts
Schema files             contract-schema.ts
Type modules             feature.types.ts
CSS files                kebab-case.css
Tests                    source-name.test.ts / SourceName.test.tsx
```

Rules:

- use ordinary function components with explicit Props; do not default to `React.FC`;
- declare `children` only when accepted, normally as `React.ReactNode`;
- use concrete React event types or contextual inference, never `any`;
- initialize DOM refs with `null`;
- use `type` for closed Props, unions, tuples, aliases, and Feature-local models;
- use `interface` for intentionally extensible Ports and public object contracts;
- start untrusted values as `unknown` and parse once at the boundary;
- infer obvious local variables and private helper returns;
- add explicit returns to Ports, exported APIs, schema parsers, and async boundaries;
- use discriminated unions and exhaustive handling for closed states;
- use immutable snapshots and `ReadonlyArray` when callers must not mutate;
- use branded types only when runtime provenance matters, such as sanitized preview HTML;
- use utility types for local transformations, not to hide long-lived Domain meaning;
- avoid non-null assertions, broad Barrels, random Keys, and speculative Generics;
- comments explain ownership, security, compatibility, invariants, or failure behavior, not JSX narration.

## State, Events, Effects, and Lifecycle

Use one Store per application Root. Do not export a mutable module-level singleton.

State ownership:

```text
Persisted authority     PHP / WordPress
Server-derived state    one explicit owner
Editor session state    root store
Local UI draft          nearest Feature
Derived state           selector or render
Submission bridge       native WordPress fields
Recovery data           versioned local draft storage
Preferences             approved scoped storage or Options API
```

Rules:

- keep ephemeral input, hover, unconfirmed dialog fields, local validation display, and drag state near the component;
- put state shared across Features in the owning Root Store;
- keep REST-backed collections in one explicit server-state owner;
- derive Dirty and other facts rather than storing duplicate flags;
- do not mirror React state through Effects;
- update the saved baseline only after real WordPress save succeeds;
- scope Post state, operation IDs, caches, and Storage Keys by Site, User, and Post identity;
- when a new Post receives a real ID, explicitly re-key or clear Post-scoped state;
- use stable Domain identity as React Keys;
- persist only approved preferences or recovery data with a versioned schema and conflict behavior.

Use Event Handlers for work caused by a user interaction. Use Effects only to synchronize an external system after render.

Do not use Effects to calculate renderable data, copy Props into State, mirror Stores, indirectly process a button click, trigger a Mutation because a boolean became true, or reset state that an explicit event or stable Key can own.

Every Effect has one external responsibility, complete dependencies, a failure path, and idempotent cleanup.

Clean up Listeners, Subscriptions, Observers, Timers, Animation Frames, Abort Controllers, Object URLs, Portals, Overlays, temporary DOM, Body Classes, inline styles, CSS variables, scroll locks, Selection changes, and Pointer Capture.

Strict Mode and repeated activation must not duplicate writes, uploads, clipboard operations, subscriptions, timers, or native handlers.

## Runtime Ports and Interface Design

Features depend on focused project capabilities rather than WordPress globals or selectors:

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

Representative result contract:

```ts
type SaveResult =
  | Readonly<{ status: 'saved'; postId: number; revisionId?: number }>
  | Readonly<{ status: 'cancelled' }>
  | Readonly<{ status: 'permission-denied'; code: string }>
  | Readonly<{ status: 'conflict'; code: string }>
  | Readonly<{ status: 'failed'; code: string; retryable: boolean }>;
```

Interface philosophy:

- one Port represents one external-system responsibility;
- name methods by project intent, not generic transport verbs;
- keep Commands and Queries conceptually distinct;
- use one Options Object for related or evolving parameters;
- avoid ambiguous boolean parameters;
- return immutable snapshots, not internal mutable references;
- model expected cancellation, validation, conflict, permission, and unavailable states as typed results;
- reserve thrown exceptions for defects or unexpected infrastructure failures;
- keep server Error Code, HTTP Status, and translated message separate;
- accept `AbortSignal` for cancellable asynchronous work;
- every subscription returns an idempotent unsubscribe function;
- do not expose DOM nodes, REST clients, concrete Stores, or WordPress globals;
- do not grow a universal `EditorAdapter`, `WordPressService`, generic `execute(type, payload)`, or stringly typed event bus;
- test Adapters against Port contracts and Features against mock Ports.

Only Entrypoints and relevant Integrations may know `window.EasyMDEConfig`, `window.wp`, `wp.apiFetch`, jQuery, WordPress selectors, native save/publish controls, `wp.media`, browser Storage, Clipboard APIs, or legacy `execCommand` fallback.

## Bootstrap, REST, and Cross-Language Contracts

TypeScript Interfaces do not validate PHP, REST, Storage, Manifest, or extension values. Parse external values at the boundary.

Use versioned runtime schemas for:

- Editor and Settings bootstrap data;
- REST Requests and Responses;
- extension commands;
- browser-storage payloads;
- build Manifests and WordPress dependency metadata.

Rules:

- validate required fields before mounting or executing a protected operation;
- ignore unknown optional fields only when safe;
- fail clearly on an unknown incompatible version;
- increment a version when old consumers cannot safely interpret a new payload;
- never change a field's meaning in place;
- keep endpoint URLs, limits, locale, text direction, Site timezone, Storage identity, and Feature availability in the owning contract;
- do not serialize credentials, Cookies, private configuration, or unrelated article content;
- add cross-language fixtures that serialize representative PHP payloads and parse them with TypeScript runtime schemas;
- do not add OpenAPI, GraphQL code generation, tRPC, or a schema library merely because another project uses it.

REST rules:

- every protected Route has an action-specific `permission_callback`;
- authentication or a valid nonce does not replace authorization;
- validate precise input where possible and sanitize where exact validation is not possible;
- escape near output;
- return data, `WP_REST_Response`, or `WP_Error`;
- preserve stable Error Codes and Status separately from translated messages;
- do not expose raw response HTML as a user message;
- do not retry Mutations automatically;
- only bounded idempotent Reads may retry with cancellation and stale-result protection.

## Preview and Native WordPress Operations

Formal Preview flow:

```text
Markdown
→ PreviewPort
→ POST easymde/v1/preview
→ PreviewController
→ MarkdownRenderer produces sanitized HTML
→ MarkdownFeatureDetector produces Feature Manifest
→ { html, features }
→ branded Safe Preview HTML
→ local Mermaid, KaTeX, Highlight.js, and TOC enhancement
```

`MarkdownRenderer` does not own the Feature Manifest. `PreviewController` combines renderer output with `MarkdownFeatureDetector` results.

Use one Preview-owned HTML sink. Markdown, AI output, error HTML, arbitrary REST values, Custom CSS, extension data, and Storage values never enter that sink directly.

Preview requests support Abort, request identity, stale-result rejection, payload limits, explicit failures, and enhancement cleanup. Enhancement failure preserves sanitized HTML. Never add another formal Markdown renderer or silent approximate fallback.

Native operations:

- synchronize accepted document transactions to native submission fields before native serialization;
- do not debounce the Submission Bridge;
- do not treat field synchronization as persisted success;
- observe the actual WordPress save or publish result;
- do not force-click a disabled or missing native control;
- preserve WordPress unload and Dirty behavior without duplicate prompts;
- preserve Heartbeat, Post Locks, authentication changes, and nonce refresh;
- stop protected writes when capability, authentication, or lock state is lost;
- retain unsaved session content when safe;
- opening an ordinary supported Post remains zero-write until the next legitimate save.

Feature boundaries:

- **Publishing:** React owns a temporary Publish Draft; WordPress owns real fields and final operation. Cancel is zero-write.
- **Revisions:** WordPress owns identity and persistence. Restore Markdown and appearance together and let PHP regenerate compatibility HTML.
- **Media:** use `MediaPort`; insert Markdown only after successful upload while the originating transaction remains current; restore Selection and Focus.
- **Themes and Custom CSS:** choices come from PHP Registries; `CustomCssPolicy` remains the security owner.
- **Settings:** use a separate Root; `manage_options`, Options API, `register_setting()`, and PHP Sanitization remain authoritative.
- **Local drafts:** Recovery data is not a WordPress save; scope Keys by Site, User, Post, and Schema Version; never store Nonces or credentials.
- **WeChat export:** copy only the current stable sanitized Preview; Clipboard rejection is a failure; fallback restores Selection, Focus, Scroll, and temporary DOM.
- **AI assistant:** use `AiPort` and explicit user action; keep credentials server-side; generated changes are visible, rejectable, and undoable; never automatically save, publish, upload, change settings, or execute returned code.

## Accessibility, UI, and CSS Quality

Accessibility is part of the Component contract:

- use native semantic controls;
- give every control an accessible name;
- label icon-only buttons explicitly;
- hide decorative icons from assistive technology;
- preserve visible focus;
- do not use color as the only state signal;
- associate labels, help, and errors with fields;
- preserve entered values after validation or network failure;
- prevent duplicate state-changing actions while pending without disabling unrelated work;
- label Dialogs, contain focus, define safe Escape behavior, and return focus;
- do not close destructive, publishing, unsaved, or in-progress Dialogs by accidental backdrop click;
- make Toolbars, Menus, and Split Panes keyboard operable;
- preserve Selection and restore Focus for editor commands;
- respect IME composition;
- release Pointer Capture on cancellation and teardown;
- test long translations, RTL, zoom, text scaling, reduced motion, forced colors, and high contrast where relevant.

Scope Admin CSS under a stable EasyMDE Root. Do not apply broad WordPress Admin element rules, borrow unrelated legacy classes, or use arbitrary offsets and broad `!important` to hide an incorrect layout owner.

Use project Tokens, logical properties, a controlled z-index scale, approved local icons, and deterministic UI states. Keep Admin Tokens separate from public article Themes.

## Performance and Bundle Quality

Keep the keystroke path small:

- update session Markdown immediately;
- debounce Preview and expensive derived work, not controlled input or the Submission Bridge;
- subscribe to the smallest State slice;
- derive values in render or pure selectors;
- do not parse the entire document independently for each Feature on every keystroke;
- lazy-initialize expensive local State;
- use functional updates when the next value depends on the previous value;
- use Refs only for transient values that do not affect rendering;
- do not add `memo`, `useMemo`, or `useCallback` everywhere;
- optimize after measurement or when identity is an explicit API contract;
- do not use `startTransition()` for editor value, Submission Bridge, Save/Publish state, Focus restoration, or accessibility-critical state;
- use `React.lazy()` only for optional heavy UI with an accessible fallback;
- do not use Suspense as an implicit WordPress data layer.

Start independent authorized Reads together; preserve order for dependent Reads and Mutations. Abort obsolete work and reject stale completion.

Measure large-document typing, Preview latency, mount time, Toolbar and Dialog interaction, repeated-lifecycle memory, listener counts, entry size, optional chunks, duplicate dependencies, and private React inclusion.

Do not trade correctness, accessibility, diagnostics, or stale-result protection for a benchmark.

## Build and Dependency Rules

Use Vite from the root npm package. Source belongs under `frontend/`; compiled runtime belongs under `assets/build/`.

The first build implementation chooses and validates one coherent strategy:

- classic WordPress Scripts; or
- WordPress Script Modules / ESM.

Do not claim IIFE output and ordinary dynamic chunks both work without a loader contract.

For every strategy:

- use the WordPress React runtime;
- correctly externalize or map `react`, `react-dom`, `@wordpress/element`, and the JSX runtime;
- generate and verify Manifest and dependency metadata;
- keep primary WordPress handles stable;
- allow hashed chunks only with a Manifest-backed loader;
- resolve assets from the Plugin Asset Base, never `/`;
- do not hardcode `/wp-content/plugins/easymde/`;
- verify subdirectory, Multisite, and non-default Plugin URL behavior where relevant;
- keep runtime assets local;
- fail on missing, stale, duplicate, or inconsistent Manifest entries;
- fail if a production entry or chunk contains a private React implementation;
- exclude Dev Server URLs, Localhost, source paths, prohibited Source Maps, remote CDN references, and development code.

A dependency needs a current responsibility, non-duplicative purpose, compatible license, acceptable direct and transitive size, active maintenance, no prohibited telemetry or remote runtime, tests, removal strategy, Lockfile update, and third-party notice update.

Do not add a State, Query, Form, Router, Schema, Animation, Icon, or Utility library merely because a blog, react-admin, or a generic Skill recommends it.

## Testing, Release, and Completion

Choose tests by responsibility:

- `domain`: pure rules and edge cases;
- `contracts`: schema versions, PHP/TS fixture parity, Error Mapping, safe values, and Manifest contracts;
- `integrations`: WordPress DOM, native form, nonce refresh, Locks, REST, Media, Storage, Clipboard, mounting, and failure paths;
- `features`: Controller, Hook, Component, Focus, keyboard, and form behavior through mock Runtime;
- `app`: Providers, independent Stores, Error Boundaries, activation, and teardown;
- E2E: real WordPress behavior using the installable ZIP;
- release: required compiled entries present and development files absent.

Enforce when tooling exists:

- strict TypeScript and `noEmit`;
- Hook and accessibility lint rules;
- dependency direction and restricted globals;
- approved React runtime imports;
- valid Manifest, dependency metadata, CSS, and chunks;
- PHP-to-TypeScript contract parity;
- installable ZIP inclusion and exclusion.

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
development server metadata
unrelated development files
```

Before reporting a Feature complete, verify the scope-relevant items:

1. Every fact and behavior has one Owner.
2. Component hierarchy follows the data model and user-recognizable responsibilities.
3. Render functions and Hooks are pure.
4. State is minimal, non-duplicated, and intentionally reset.
5. Directory placement and dependency direction are correct.
6. Props, events, Refs, Hook APIs, names, and public exports follow project conventions.
7. External values are runtime-validated.
8. Components use focused Ports and do not access WordPress or browser globals directly.
9. PHP and WordPress capability, nonce, validation, sanitization, escaping, data, save, publish, and lock authority remain intact.
10. Native-field synchronization, real operation observation, stale-result rejection, cancellation, failure, and teardown are tested.
11. Accessibility, Focus, keyboard, IME, Selection, Undo, Scroll, RTL, zoom, and relevant visual states are covered.
12. Performance conclusions have measurements.
13. Build metadata, React externalization, local asset URLs, translations, and package exclusions are verified.
14. The exact diff, commands, CI, review findings, unverified areas, and remaining risks are reported honestly.

Maintainability rules:

- prefer a clear local implementation over a premature abstraction with unclear ownership;
- extract shared code after a stable repeated responsibility is proven;
- keep public contracts small and versioned;
- keep concrete implementations private;
- deprecate before removing public extension boundaries;
- update `docs/REACT_DESIGN_PHILOSOPHY.md` and this Skill together when a durable rule changes;
- remove obsolete rules rather than preserving contradictions;
- use the migration Skill only for temporary ownership transfer rules.

## Prohibited Patterns

Do not introduce:

1. Gutenberg replacement, Next.js, Webpack, another frontend framework, or replacement publishing backend.
2. React 19-only APIs, private React runtime, Hydration, RSC, or Server Actions.
3. A browser formal Markdown renderer or CSS security parser.
4. A second canonical document, save, publish, revision, media, settings, timezone, or public-content authority.
5. Components that directly access WordPress DOM, jQuery, `wp.apiFetch`, `wp.media`, Storage, Clipboard, or global Bootstrap.
6. Universal Adapters, generic `execute(type, payload)`, God Components, shared mutable Root Stores, or stringly typed event buses.
7. Circular dependencies, upward imports, broad Barrels, Feature-private deep imports, catch-all directories, or speculative abstraction layers.
8. Render-time side effects, Effect-driven user commands, mirrored State, duplicated authority, or impossible boolean-prop combinations.
9. Random Keys, index Keys for reorderable Domain data, or accidental State reset through nested component definitions.
10. Silent fallback, swallowed errors, fake success, hidden writes, force-clicked disabled controls, or automatic Mutation retries.
11. Stale async work updating the current Post, Root, Dialog, or Session.
12. Effects without cleanup, idempotence, failure handling, and repeated-lifecycle safety.
13. Browser-local scheduling overriding WordPress Site timezone.
14. Implementations that ignore extension Registries or only support built-in commands.
15. Root-relative Plugin asset URLs, remote runtime CDNs, production Dev Server references, or unapproved telemetry.
16. Empty Feature directories, placeholder modules, unused assets, or dependencies without a current Owner.
17. Private article content, Custom CSS, prompts, Tokens, Nonces, credentials, or secret endpoints in diagnostics.
18. Source, tests, caches, logs, `.agents/`, or development metadata in the installable ZIP.
19. A react-admin, generic Skill, blog, or search recommendation treated as stronger than EasyMDE project evidence.
