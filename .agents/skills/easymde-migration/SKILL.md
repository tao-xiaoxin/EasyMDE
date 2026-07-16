---
name: easymde-migration
description: Use this temporary Skill only when planning, implementing, validating, reviewing, deprecating, or removing a focused migration unit that transfers existing EasyMDE browser-side behavior from legacy JavaScript ownership to the approved React, TypeScript, and Vite architecture. Do not use it for ordinary post-migration React feature work, unrelated PHP maintenance, documentation-only changes, or as authority to redesign behavior outside the linked Issue.
---

# EasyMDE Migration Guide

This is a temporary execution Skill for the migration tracked by Issue #74.

It controls how existing EasyMDE browser-side behavior moves from legacy JavaScript ownership into the approved React, TypeScript, and Vite architecture while the editor remains usable.

It does not replace:

- `AGENTS.md`;
- `docs/REACT_ARCHITECTURE.md`;
- `.agents/skills/easymde/SKILL.md`;
- focused migration Issues;
- the live repository as the source of current behavior.

Delete this Skill after the full migration is complete and the deletion gate in this document is satisfied. Long-term development continues under `.agents/skills/easymde/SKILL.md`.

## Rule Priority

Apply rules in this order:

1. The explicit task, linked GitHub Issue, and human maintainer decision.
2. Root `AGENTS.md` and the live EasyMDE repository.
3. `docs/ARCHITECTURE.md` and `docs/REACT_ARCHITECTURE.md`.
4. `.agents/skills/easymde/SKILL.md`.
5. This migration Skill.
6. Generic companion Skills that are actually available.
7. Secondary articles, examples, and search results.

A lower-priority source may improve execution but must not override EasyMDE data, security, WordPress, runtime, directory, save, publish, preview, extension, privacy, testing, or release contracts.

Do not claim that a companion Skill was loaded, followed, or validated unless its actual contents were available in the current environment. When a named Skill is unavailable, use only the responsibility described below and do not invent hidden rules.

## Temporary Responsibility

Use this Skill only for work that changes migration ownership, including:

- introducing a migration seam used by legacy and React code;
- extracting pure domain behavior from a legacy module;
- moving a user-facing capability into React;
- activating React ownership for one behavior;
- deprecating a superseded legacy owner;
- removing a proven obsolete implementation;
- removing migration-only compatibility code;
- validating the final migration state;
- deleting this Skill after migration completion.

Do not use this Skill for:

- normal React feature development after a capability has one stable React owner;
- unrelated PHP, REST, theme, release, or documentation maintenance;
- visual redesign not required by the linked migration Issue;
- replacing WordPress native behavior;
- speculative foundation work with no current migration unit;
- bulk conversion of every file or directory;
- creating placeholders for later phases.

## Three-File Responsibility Model

### `docs/REACT_ARCHITECTURE.md`

Long-term architecture decisions:

- system and WordPress authority;
- source layout;
- dependency direction;
- application root ownership;
- interface philosophy;
- runtime and build architecture;
- data and release boundaries.

### `.agents/skills/easymde/SKILL.md`

Long-term implementation guidance:

- React and TypeScript code quality;
- component, Hook, Port, naming, state, accessibility, performance, security, testing, build, privacy, and release practices;
- normal maintenance after migration.

### `.agents/skills/easymde-migration/SKILL.md`

Temporary migration execution:

- behavior characterization;
- focused migration specification;
- old-owner and new-owner inventory;
- migration seams and atomic activation;
- rollback and deprecation;
- proof before legacy removal;
- final removal of migration-only guidance.

Do not duplicate a durable rule here when it belongs in the architecture document or long-term Skill. When a migration discovers a durable project rule, update the long-term owner in the same focused task.

## Companion Skill Orchestration

Use the following named Skills only when their contents are available. Project rules remain authoritative.

### `spec-driven-development`

Use it to make the focused migration Issue executable before implementation.

Required outputs:

- user-visible behavior being preserved or intentionally changed;
- current owner and target owner;
- data and security authorities;
- invariants and non-goals;
- success, failure, cancellation, stale-result, teardown, and rollback behavior;
- acceptance evidence;
- removal gate;
- explicit unverified areas.

The specification must describe observable behavior, not only file movement.

### `deprecation-and-migration`

Use it to govern the lifecycle of legacy owners, shims, selectors, events, script handles, bootstrap fields, and compatibility paths.

Every deprecation needs:

- the thing being deprecated;
- its current consumers;
- the replacement contract;
- compatibility period;
- warning or diagnostic strategy when useful;
- removal prerequisites;
- removal Issue;
- final verification.

Do not mark code deprecated merely to postpone an unresolved ownership problem.

### `frontend-ui-engineering`

Use it for faithful UI behavior, component boundaries, responsive behavior, CSS isolation, interaction states, focus, keyboard, pointer, IME, selection, undo, scroll, portals, overlays, and cleanup.

Migration is not permission for unrelated visual redesign.

### `test-driven-development`

Use it to protect behavior before changing ownership.

Prefer:

1. characterize current observable behavior;
2. write the smallest failing test for the migration contract;
3. implement the seam or owner;
4. make the test pass;
5. remove duplication only after equivalent behavior is proven;
6. refactor while tests remain green.

Do not write tests that merely encode the proposed implementation structure.

### `browser-testing-with-devtools`

Use it for real browser evidence:

- console errors and warnings;
- network requests and cancellation;
- DOM ownership and duplicate handlers;
- focus and active element;
- event listeners, observers, timers, portals, and cleanup;
- layout, overflow, stacking, and responsive states;
- memory after repeated mount and unmount;
- release-ZIP behavior in a clean WordPress installation.

Use synthetic content and keep browser evidence private unless publication is explicitly required and reviewed.

### `security-and-hardening`

Use it for:

- capability checks;
- nonce handling;
- REST `permission_callback`;
- request validation;
- sanitization and late escaping;
- safe HTML boundaries;
- URL and upload policy;
- extension input;
- diagnostics redaction;
- AI and external-provider boundaries.

React capability flags improve UI only. PHP and WordPress authorize every protected action.

### `wp-plugin-development`

Use it for WordPress ownership and package behavior:

- supported-post admission;
- Hooks and service composition;
- native save and publish;
- Heartbeat, locks, autosave, revisions, media, taxonomies, scheduling, Options API, and REST;
- script handles, dependency metadata, translations, plugin URL handling, and release packaging;
- WordPress 6.7 and latest supported WordPress validation.

Do not replace WordPress behavior with a browser-only implementation.

### `performance-optimization`

Use it after a baseline exists.

Measure:

- typing latency;
- preview scheduling and completion;
- mount and ready time;
- toolbar and dialog interaction;
- memory and listener counts after repeated lifecycle;
- initial entry size and optional chunks;
- duplicate React or unexpectedly eager dependencies.

Do not claim improvement from code shape alone.

### `code-review-and-quality`

Use it to review the exact committed diff against the linked Issue, architecture, long-term Skill, migration contract, tests, package contents, and protected surfaces.

Review confirmed defects, not stylistic preferences detached from project rules.

### `react-best-practices`

Apply only React 18-compatible client guidance:

- pure rendering;
- minimal state;
- event handlers before Effects;
- cleanup and stale-result protection;
- selector-based subscriptions;
- measured memoization;
- optional code splitting;
- bundle inspection.

Do not apply Next.js, RSC, Server Actions, hydration, React 19-only APIs, or private React runtime assumptions.

### `composition-patterns`

Use it to keep component APIs explicit and state close to its owner:

- discriminated variants;
- narrow compound components when one semantic control shares state;
- focused provider contracts;
- controlled and uncontrolled ownership;
- explicit children and render-prop contracts;
- no impossible boolean combinations.

Do not turn every Feature into a generic component framework.

### `web-design-guidelines`

Use it for semantic HTML, accessible names, forms, errors, focus, keyboard behavior, contrast, zoom, RTL, reduced motion, and safe dialog behavior.

EasyMDE product and WordPress admin rules override generic website assumptions.

## Migration Unit

A migration unit is the smallest independently reviewable slice that transfers one coherent user behavior or external responsibility.

Good migration units:

- one pure outline parser;
- one preview scheduler;
- one theme selector;
- one custom CSS dialog;
- one revision list and restore flow;
- one publishing dialog;
- one toolbar command family;
- one workspace pane controller;
- one media insertion path;
- one local-draft owner;
- one WeChat export path.

Bad migration units:

- “convert the frontend”;
- “move all files under `assets/js/admin/`”;
- “create the whole future directory tree”;
- “replace every dialog”;
- “add a universal bridge for later”.

A unit must have one observable outcome, one owner handoff, focused tests, and a removal gate.

## Required Migration Specification

Before editing production code, record the following in the linked Issue or implementation plan:

```text
Migration unit:
User-visible behavior:
Current owner:
Target owner:
Persisted authority:
Browser-session authority:
WordPress/native dependencies:
Protected public or extension contracts:
Known consumers:
Success behavior:
Failure behavior:
Cancellation behavior:
Stale-result behavior:
Teardown behavior:
Rollback behavior:
Performance baseline:
Accessibility contract:
Visual contract:
Tests before change:
Tests after change:
Legacy-removal gate:
Out of scope:
Unverified areas:
```

Do not begin ownership transfer when current behavior, consumers, or removal criteria are unknown.

## Current-Owner Inventory

Inspect the live repository and trace the complete behavior.

At minimum inspect relevant parts of:

```text
AGENTS.md
docs/ARCHITECTURE.md
docs/REACT_ARCHITECTURE.md
assets/js/admin/
assets/css/admin/
templates/admin/
src/Admin/
src/Content/
src/Rest/
src/Theme/
src/Frontend/
src/Support/
tests/
scripts/build-release.mjs
package.json
```

For the migration unit, inventory:

- script handles and dependencies;
- PHP bootstrap fields;
- DOM roots and selectors;
- native form fields;
- jQuery events;
- custom events;
- document and window listeners;
- MutationObservers;
- timers and animation frames;
- editor-instance ownership;
- REST routes and error codes;
- storage keys;
- media callbacks;
- clipboard flows;
- extension registries;
- CSS roots and protected selectors;
- test fixtures;
- release-package inputs.

Do not infer ownership from filenames alone.

## Target Placement

Place new code according to the approved architecture:

```text
frontend/src/
├── entrypoints/
├── app/
│   ├── editor/
│   └── settings/
├── contracts/
├── domain/
├── features/
├── integrations/
│   ├── wordpress/
│   ├── preview-runtime/
│   └── browser/
├── shared/
└── test/
```

Placement rules:

- `entrypoints/`: bootstrap validation, runtime composition, root mount, readiness, activation, teardown;
- `app/`: one root's shell, providers, store, error boundary, and lifecycle;
- `contracts/`: runtime schemas, Ports, results, error codes, safe-value types;
- `domain/`: pure rules with no React, DOM, WordPress, network, or storage access;
- `features/`: user-facing capabilities and their local UI/model;
- `integrations/`: concrete WordPress, REST, DOM, media, storage, clipboard, diagnostics, and enhancement adapters;
- `shared/`: genuinely reusable code with no Feature or WordPress ownership.

Do not create empty directories or files for future phases.

## Migration Direction

Use one-way dependencies:

```text
entrypoints  → app, contracts, integrations
app          → features, contracts, shared
features     → domain, contracts, shared
integrations → contracts, domain, shared
contracts    → domain types, shared types
domain       → shared pure utilities and types
shared       → no app, Feature, integration, or WordPress ownership
```

Legacy code may temporarily call a new pure domain function or focused adapter to prove a seam.

New React Features must not import legacy modules as their long-term domain or state owner.

A compatibility bridge must be directional, narrow, documented, and removable.

## Characterization Before Replacement

Before replacing a legacy behavior, add or identify evidence for:

- normal success;
- empty state;
- invalid input;
- missing capability;
- rejected request;
- missing native control;
- stale response;
- rapid repeated action;
- cancellation;
- repeated open and close;
- page or post identity change;
- WordPress extension modification;
- release-ZIP installation.

Characterization may use unit, integration, or browser tests depending on the behavior.

Do not preserve accidental bugs without deciding whether they are compatibility contracts. Record the decision.

## Pure Logic Extraction

Extract pure domain behavior before moving UI when doing so reduces risk.

Candidates include:

- title and line-ending normalization;
- Markdown transformations;
- outline parsing;
- statistics;
- dirty-state calculations;
- table generation;
- category tree shaping;
- publish-draft normalization;
- selection calculations;
- image candidate selection.

Rules:

- import the real TypeScript function in tests;
- do not parse production source text to recover functions;
- do not execute browser bundles in a VM to prove pure logic;
- preserve input and output semantics;
- use immutable values;
- keep WordPress, DOM, React, storage, and network out of `domain/`.

## Ports Before UI Ownership

React Features call focused Ports, not globals or selectors.

Representative migration runtime:

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

Port principles:

- name methods by intent;
- separate reads from commands;
- use immutable snapshots;
- use typed result unions for expected outcomes;
- throw only for defects or truly unexpected failures;
- use options objects instead of ambiguous boolean parameters;
- accept `AbortSignal` for cancellable work;
- make subscriptions return idempotent unsubscribe functions;
- keep WordPress selectors and response shapes inside adapters;
- do not build `execute(type, payload)` or a universal `WordPressService`.

## Ownership Ledger

Maintain a migration ledger in the linked Issue or PR.

Example:

| Behavior | Legacy owner | New owner | Activation condition | Removal gate | Status |
| --- | --- | --- | --- | --- | --- |
| Preview scheduling | `preview.js` | `features/live-preview` | React root ready and PreviewPort valid | E2E, stale cancellation, no duplicate scheduler | planned |
| Publish dialog | native module | `features/publishing` | capabilities and native fields validated | publish/update/schedule tests, zero hidden writes | planned |

Allowed status values:

```text
discovered
characterized
seam-ready
react-shadow-read
react-active
legacy-deprecated
legacy-removable
legacy-removed
verified
```

Do not mark a unit `react-active` before its activation condition is observable.

## One Active Owner

Every state-changing behavior has exactly one active owner.

Prohibited:

- two save handlers;
- two publish handlers;
- two preview schedulers;
- two draft timers;
- two shortcut managers;
- two media insertion handlers;
- two clipboard exporters;
- two sources of canonical document state;
- legacy and React both writing the same native field independently.

Read-only comparison is allowed only when:

- it has no visible side effect;
- it does not issue duplicate protected requests;
- it does not persist data;
- results are used only for local verification;
- it is removed after the comparison period.

Dual write is prohibited.

## Atomic Activation

Use an explicit activation sequence:

```text
discover legacy contract
→ validate bootstrap and capability
→ create runtime and root-owned store
→ mount React
→ verify ready state
→ activate React owner marker
→ detach only the superseded legacy owner
```

Rules:

- do not hide the legacy owner before React readiness;
- do not detach unrelated legacy behavior;
- activation must be idempotent;
- failure before activation preserves the legacy owner;
- failure after activation follows the written rollback contract;
- DOM presence is not enough to prove ownership;
- activation must be testable.

## Rollback

Every migration unit defines rollback before activation.

Rollback may restore the previous owner only when:

- the old implementation still exists;
- restoring it does not create dual ownership;
- state can be synchronized safely;
- no protected write has partially completed;
- the user receives an honest message.

For destructive or irreversible operations, fail before activation or require explicit recovery behavior.

Do not use silent fallback that hides a broken React owner.

## Native Form and WordPress Ownership

Preserve these authorities:

- `_easymde_markdown` is canonical Markdown;
- `post_content` is sanitized compatibility output;
- PHP `MarkdownRenderer` is the formal renderer;
- PHP and WordPress own capabilities, nonces, meta, revisions, media, taxonomies, save, publish, status, locks, autosave, scheduling, settings, and public output.

Native form rules:

- synchronize accepted document transactions to native submission fields before native serialization;
- do not debounce the submission bridge;
- do not treat field synchronization as persisted success;
- observe the actual WordPress save or publish result;
- never force-click a disabled or missing native control;
- preserve WordPress unload and dirty-state behavior without duplicate prompts;
- preserve Heartbeat, post locks, authentication changes, and nonce refresh;
- stop protected writes when capability or lock state is lost;
- retain unsaved session content when safe.

Opening an ordinary supported post remains zero-write until the next legitimate save.

## REST and Security

For every protected route:

- define an action-specific `permission_callback`;
- verify the real WordPress capability in PHP;
- verify nonce or REST authentication independently;
- validate precise input where possible;
- sanitize values that cannot be precisely validated;
- escape near output;
- return data, `WP_REST_Response`, or `WP_Error`;
- keep stable error codes;
- never branch on translated messages;
- never expose raw response HTML as a user message.

Do not retry mutations automatically.

Only bounded idempotent reads may retry, with cancellation and stale-result protection.

## React Ownership Rules

React migration follows React 18 behavior:

- render is pure;
- user actions happen in event handlers or commands;
- Effects synchronize external systems;
- every Effect has one purpose and cleanup;
- state remains minimal;
- derived values are computed;
- state identity is preserved or reset intentionally;
- high-frequency Markdown does not flow through broad Context;
- stale closures are handled with correct dependencies, functional updates, or focused refs;
- memoization follows measurement or identity contracts;
- optional heavy UI may be lazy-loaded;
- React 19-only APIs, hydration, RSC, and Server Actions are prohibited.

Do not bundle a private React runtime. Use WordPress-provided React through `@wordpress/element` and `wp-element`.

## Component and Composition Rules

During migration:

- keep components aligned with user-recognizable responsibilities;
- use explicit Props;
- use discriminated unions for materially different variants;
- keep state in the nearest owner;
- use compound components only for one cohesive semantic control;
- keep controlled and uncontrolled modes explicit;
- do not switch ownership mode during one lifecycle;
- do not add generic components before two or more stable responsibilities prove reuse;
- do not use random keys;
- do not use array indexes for reorderable domain entities;
- do not define component types inside render when identity must persist.

A migrated component is not complete when it only matches the happy-path screenshot.

## TypeScript Rules

Use strict TypeScript from the first frontend toolchain.

At minimum evaluate and enable supported strictness such as:

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "useUnknownInCatchVariables": true,
    "noFallthroughCasesInSwitch": true
  }
}
```

Rules:

- ordinary function components with explicit Props;
- explicit `children` only when supported;
- concrete React event types;
- DOM refs initialized with `null`;
- `type` for closed Props, unions, tuples, and local models;
- `interface` for intentionally extensible Ports and public object contracts;
- `unknown` plus parsing at external boundaries;
- no `any` as a validation shortcut;
- no unsafe non-null assertions;
- no broad `export *` barrels;
- exhaustive handling for closed unions;
- runtime validation for PHP, REST, storage, manifest, and extension inputs;
- avoid speculative generics and utility-type puzzles that hide domain meaning.

## Test-Driven Migration

Choose the lowest reliable test layer.

### Domain tests

Prove pure transformations, normalization, state transitions, and edge cases.

### Contract tests

Prove:

- bootstrap versions;
- PHP-to-TypeScript fixtures;
- REST schema and error mapping;
- Port result semantics;
- extension command shapes;
- safe HTML construction;
- build manifest and dependency metadata.

### Adapter tests

Prove:

- DOM field synchronization;
- current nonce access;
- native control discovery;
- lock and capability events;
- media, storage, clipboard, and REST failure normalization;
- idempotent subscription cleanup.

### Component tests

Prove:

- rendering from typed state;
- direct interaction;
- focus;
- keyboard;
- forms;
- accessible names;
- error and pending states;
- controlled ownership.

### Browser tests

Prove complete WordPress behavior against the installable release ZIP.

Do not rely on snapshots alone for interactive behavior.

## Browser and DevTools Evidence

For a migrated surface, inspect:

- console errors and React warnings;
- request count, order, cancellation, status, and payload boundaries;
- duplicate event listeners;
- MutationObserver and timer cleanup;
- active element and focus return;
- portal and scroll-lock cleanup;
- selection, IME, undo, and scroll preservation;
- layout and overflow;
- stacking contexts;
- disabled and pending controls;
- memory and listener counts after repeated open and close;
- behavior in a WordPress subdirectory or non-default plugin URL when assets change.

Use deterministic synthetic content.

Do not publish HAR files, screenshots, traces, storage, or logs containing private article content, nonces, cookies, credentials, local paths, or secret endpoints.

## UI Fidelity and Accessibility

Preserve approved behavior and appearance unless the linked Issue explicitly changes them.

Validate relevant states:

```text
loading
empty
ready
hover
focus-visible
active
disabled
pending
success
error
permission denied
conflict
open
closed
long content
translated content
RTL
narrow viewport
200% zoom
reduced motion
forced colors
```

Requirements:

- semantic controls;
- accessible names;
- labels and error relationships;
- visible focus;
- safe dialog cancellation;
- correct focus containment and return;
- keyboard-operable toolbars, menus, and split panes;
- no accidental backdrop close for destructive, publishing, unsaved, or in-progress dialogs;
- no hidden write on close or cancel;
- long translation and RTL support;
- local assets only.

Migration does not authorize replacing the approved design with a generic WordPress or component-library appearance.

## Performance Evidence

Record a baseline before optimization.

For affected scopes measure:

- editor keystroke latency;
- preview request scheduling and completion;
- mount-to-ready time;
- dialog and toolbar interaction;
- outline and revision rendering;
- memory after repeated lifecycle;
- number of listeners, observers, and timers;
- initial entry size;
- optional chunk size;
- duplicate dependencies;
- private React runtime inclusion.

Do not use a faster benchmark to justify lost correctness, accessibility, cancellation, stale-result protection, or diagnostics.

Do not introduce virtualization, workers, `content-visibility`, broad memoization, or new performance libraries without measured need and focused tests.

## Deprecation Lifecycle

Every superseded owner moves through explicit states.

### Active

The legacy behavior is the production owner.

### Deprecated

A replacement exists or is planned, but the legacy owner may still be active. New code must not expand its responsibility.

### Blocked for new use

No new Feature may depend on the legacy contract except a documented compatibility bridge.

### Removable

All removal prerequisites pass and no supported consumer requires the owner.

### Removed

Code, CSS, events, selectors, bootstrap data, tests, comments, and documentation are deleted or intentionally retained as public contracts.

Do not leave dead modules, CSS, selectors, or compatibility comments after removal.

## Compatibility Shim Rules

A shim is allowed only when it has:

- one named compatibility purpose;
- a documented consumer;
- a typed input and output;
- no new business logic;
- no hidden write;
- no silent fallback;
- a removal Issue;
- a test;
- a finite lifetime.

Do not create permanent “temporary” bridges.

Shims may adapt shape or lifecycle. They must not become another authority.

## Legacy Removal Gate

Remove a legacy owner only after all relevant conditions pass:

- current behavior is characterized;
- React owner is active and observable;
- one active-owner test exists;
- success, failure, cancellation, stale result, and teardown are covered;
- native save/publish and zero-write behavior remain correct;
- WordPress 6.7 and latest supported WordPress pass;
- accessibility and interaction evidence exists;
- release ZIP behavior passes;
- protected extension contracts are preserved;
- no current consumer imports, calls, listens to, queries, or styles the legacy owner;
- rollback is no longer required or is provided by the new owner;
- linked Issue explicitly authorizes removal;
- exact diff is reviewed.

Search for references before deletion, including script handles, selectors, events, CSS classes, bootstrap fields, tests, docs, and build scripts.

## CSS Removal Gate

Before deleting legacy CSS:

- prove no retained PHP template, public page, normal editor mode, extension, or fallback uses the selector;
- confirm React replacement styles are root-scoped;
- compare computed styles and layout for changed and protected surfaces;
- verify focus, hover, active, disabled, error, long-content, RTL, zoom, and responsive states;
- confirm the release ZIP contains replacement assets;
- remove stale variables, animations, icons, and preload references.

Do not delete CSS only because the visible React path looks correct once.

## Extension Compatibility

Before migration or removal, inventory:

- public facade methods;
- WordPress actions and filters;
- REST namespace and routes;
- toolbar registry;
- shortcode helpers;
- theme and code-theme IDs;
- custom CSS IDs;
- script handles;
- DOM selectors documented for integrations;
- event names;
- ordering and collision behavior.

Keep extension identifiers stable unless the linked Issue explicitly changes the public contract and defines deprecation.

Never execute arbitrary JavaScript strings from extension data.

## Failure and Observability

Migration failures must be diagnosable without leaking content.

Use stable diagnostics with:

- Feature;
- migration unit;
- old owner;
- new owner;
- operation ID;
- request ID;
- post ID when appropriate;
- contract version;
- failure code;
- activation state.

Exclude:

- Markdown;
- titles;
- excerpts;
- custom CSS;
- prompts and model output;
- cookies;
- nonces;
- tokens;
- credentials;
- private endpoints;
- local paths;
- raw responses.

Do not swallow a failure to preserve the appearance of a successful migration.

## Commit and Pull Request Discipline

For each focused migration Issue:

1. start from the current target branch;
2. keep the diff limited to one migration unit;
3. stage explicit paths only;
4. inspect `git status --short`, working diff, staged diff, and final commit;
5. run tests that exercise the changed owner and protected surfaces;
6. run local read-only review when available;
7. push and observe CI for the exact head SHA;
8. investigate failures before rerunning;
9. request Bot review only after current-head required CI passes and only with the repository template;
10. do not merge or close the Issue without human maintainer authorization.

Do not use empty commits or unrelated formatting to retrigger CI.

## Review Checklist

Review the exact migration diff for:

- specification completeness;
- current-owner accuracy;
- one active owner;
- no dual writes;
- no hidden saves;
- correct target directory;
- dependency direction;
- typed Ports;
- runtime schema validation;
- React purity and Effect discipline;
- state ownership;
- WordPress capability and nonce handling;
- lock, autosave, revision, media, and publish behavior;
- extension compatibility;
- stale-result and cancellation handling;
- lifecycle cleanup;
- focus, keyboard, IME, selection, undo, and scroll;
- responsive, RTL, contrast, and visual fidelity;
- performance evidence;
- release ZIP inclusion and exclusion;
- diagnostics redaction;
- removal gate;
- honest reporting of unverified areas.

## Migration Unit Completion

A migration unit is complete only when:

1. the specification and ownership ledger are current;
2. the target owner is active under an explicit condition;
3. no duplicate state-changing owner remains;
4. relevant behavior and failure paths are tested;
5. protected WordPress and EasyMDE contracts remain intact;
6. browser and accessibility evidence is complete;
7. performance claims have measurements;
8. legacy code is either retained with a documented reason or removed through the gate;
9. build and installable package checks pass;
10. review findings are resolved or answered with evidence;
11. remaining risks and unverified areas are reported.

Green unit tests alone are not completion evidence.

## Final Migration Completion

The overall migration is complete only when:

- every capability tracked by Issue #74 has a final documented owner;
- no production state-changing behavior has both legacy and React owners;
- no required React Feature depends on legacy browser modules as its domain or state owner;
- superseded legacy JavaScript, CSS, selectors, events, timers, observers, adapters, bootstrap fields, and shims are removed;
- intentionally retained compatibility contracts are documented in long-term files;
- all migration Issues are resolved by human decision;
- WordPress 6.7 and latest supported WordPress validation pass;
- TypeScript, React, PHP, Node, release, Plugin Check, and Playwright checks pass;
- accessibility, browser, lifecycle, failure, performance, and visual evidence is complete;
- the editor remains usable and public PHP rendering remains unchanged;
- no open task requires this migration Skill.

## Migration Skill Deletion Gate

Delete `.agents/skills/easymde-migration/SKILL.md` only through a dedicated Issue and PR after all final migration conditions pass.

Before deletion:

1. move every still-valid durable rule into `docs/REACT_ARCHITECTURE.md` or `.agents/skills/easymde/SKILL.md`;
2. remove migration-only references from open Issues, PR templates, docs, and automation;
3. confirm no current workflow requires this Skill;
4. validate the exact removal diff and installable ZIP;
5. record final migration evidence;
6. obtain explicit human maintainer approval.

Do not retain this Skill indefinitely “just in case”. A completed migration should leave normal project development guidance, not permanent transitional complexity.

## Prohibited Migration Patterns

Do not:

1. perform a big-bang conversion;
2. create the entire target tree before real code needs it;
3. migrate by file count instead of behavior ownership;
4. allow dual writes;
5. run duplicate state-changing handlers;
6. hide the old owner before React readiness;
7. use silent fallback;
8. force-click disabled native controls;
9. replace native WordPress save or publish;
10. add a browser formal Markdown renderer;
11. bundle a private React runtime;
12. use React 19-only APIs;
13. introduce Next.js, RSC, Server Actions, Webpack, or Gutenberg replacement behavior;
14. use a universal adapter or stringly typed command bus;
15. place WordPress access in components;
16. preserve legacy code without consumers or a documented compatibility purpose;
17. delete legacy code before reference and package checks;
18. change visual design outside the linked migration contract;
19. claim performance, security, accessibility, browser, or compatibility success without evidence;
20. publish private browser artifacts or diagnostics;
21. keep this temporary Skill after its deletion gate passes.
