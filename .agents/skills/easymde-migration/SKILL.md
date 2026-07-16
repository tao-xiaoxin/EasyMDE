---
name: easymde-migration
description: Use this temporary Skill only when a focused Issue transfers ownership of existing EasyMDE browser-side behavior from legacy JavaScript or DOM-driven code to the approved React, TypeScript, and Vite architecture, or when deprecating and removing the superseded owner. Do not use it for ordinary post-migration React feature work, unrelated maintenance, or visual redesign outside the linked Issue.
---

# EasyMDE Migration Guide

This is a temporary execution Skill for the incremental migration tracked by Issue #74.

It governs ownership transfer while the editor remains usable. It does not repeat the long-term architecture or coding rules:

- `docs/REACT_DESIGN_PHILOSOPHY.md` explains the durable design philosophy;
- `.agents/skills/easymde/SKILL.md` governs React, TypeScript, WordPress integration, code quality, accessibility, performance, testing, build, and release;
- this Skill governs specification, characterization, seams, activation, rollback, deprecation, removal, and final cleanup.

Delete this Skill after the complete migration and its deletion gate pass.

## Rule Priority

Apply rules in this order:

1. The explicit task, linked Issue, and human maintainer decision.
2. Root `AGENTS.md`, the live repository, and current public compatibility contracts.
3. `docs/ARCHITECTURE.md` and `docs/REACT_DESIGN_PHILOSOPHY.md`.
4. `.agents/skills/easymde/SKILL.md`.
5. This temporary Skill.
6. Companion Skills that are actually available.
7. Secondary references.

Project-specific rules always win. Do not claim a companion Skill was loaded or followed unless its contents were available.

## Companion Skill Orchestration

Use the listed Skills as focused lenses, not competing architectures:

| Skill | Migration responsibility |
| --- | --- |
| `spec-driven-development` | Define observable behavior, owners, invariants, failure paths, acceptance evidence, rollback, and removal gates before implementation. |
| `deprecation-and-migration` | Track legacy contracts, consumers, replacement, compatibility period, warnings, and deletion prerequisites. |
| `frontend-ui-engineering` | Preserve UI behavior, focus, keyboard, pointer, IME, Selection, Undo, Scroll, portals, overlays, responsive layout, and CSS isolation. |
| `test-driven-development` | Characterize current behavior, write the smallest migration-contract test, implement the seam, and remove duplication only after equivalence is proven. |
| `browser-testing-with-devtools` | Inspect console, network, DOM ownership, active element, listeners, observers, timers, portals, layout, memory, and release-ZIP behavior. |
| `security-and-hardening` | Verify capabilities, nonces, REST permissions, validation, sanitization, escaping, safe HTML, upload policy, diagnostics, and AI boundaries. |
| `wp-plugin-development` | Preserve WordPress lifecycle, native Save/Publish, Locks, Autosave, Revisions, Media, Taxonomies, Options, REST, assets, translations, and packaging. |
| `performance-optimization` | Establish baselines and measure typing, Preview, mount, interaction, memory, listeners, and Bundle changes. |
| `code-review-and-quality` | Review the exact diff against specification, ownership ledger, architecture, tests, package, and protected surfaces. |
| `react-best-practices` | Apply React 18 purity, minimal State, Event-before-Effect, cleanup, stale-result protection, selectors, measured memoization, and Bundle inspection. |
| `composition-patterns` | Keep Component APIs explicit, State near its Owner, variants valid, Providers narrow, and composition intentional. |
| `web-design-guidelines` | Validate semantics, accessible names, Forms, Focus, keyboard, contrast, zoom, RTL, reduced motion, and safe Dialog behavior. |

Do not import Next.js, RSC, React 19-only behavior, Webpack, a generic CRUD architecture, React Query, React Hook Form, Material UI, Router, or another dependency merely because a companion Skill or react-admin uses it.

## When This Skill Applies

Use it when a task:

- extracts pure behavior from a legacy module;
- introduces a temporary compatibility seam;
- moves one user-facing capability into React;
- changes which implementation owns a state-changing behavior;
- deprecates or removes legacy JavaScript, CSS, selectors, events, script handles, Bootstrap fields, or compatibility shims;
- validates final migration completion;
- deletes this temporary Skill.

Do not use it for:

- normal React work after a capability has one stable owner;
- unrelated PHP, REST, Theme, release, or documentation maintenance;
- visual redesign not required by the linked migration Issue;
- bulk file conversion;
- speculative foundation work with no current migration unit;
- creating future empty directories or placeholders.

## Migration Unit

A migration unit is the smallest independently reviewable slice that transfers one coherent behavior or external responsibility.

Good units:

- one pure outline parser;
- one Preview scheduler;
- one Theme selector;
- one Custom CSS Dialog;
- one Revision list and restore flow;
- one Publishing Dialog;
- one Toolbar command family;
- one Workspace pane controller;
- one Media insertion path;
- one Local Draft owner;
- one WeChat export path.

Bad units:

- “convert the frontend”;
- “move all files under `assets/js/admin/`”;
- “create the whole future directory tree”;
- “replace every Dialog”;
- “add a universal bridge for later”.

A unit has one observable outcome, one ownership handoff, focused tests, and a removal gate.

## Required Migration Specification

Before editing production code, record:

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
Activation condition:
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

The specification describes observable behavior, not only file movement. Do not begin ownership transfer while current behavior, consumers, or removal criteria are unknown.

## Current-Owner Inventory

Inspect the live repository and trace the complete behavior. Read relevant parts of:

```text
AGENTS.md
docs/ARCHITECTURE.md
docs/REACT_DESIGN_PHILOSOPHY.md
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

Inventory the migration unit's:

- script handles and dependencies;
- PHP Bootstrap fields;
- DOM Roots and selectors;
- native form fields;
- jQuery and custom events;
- document and window listeners;
- MutationObservers;
- Timers and Animation Frames;
- editor-instance ownership;
- REST Routes and Error Codes;
- Storage Keys;
- Media callbacks;
- Clipboard flows;
- extension Registries;
- CSS Roots and protected selectors;
- test fixtures;
- release-package inputs.

Do not infer ownership from filenames alone.

## Characterize Before Replacing

Before replacement, add or identify evidence for relevant states:

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
- Post or Root identity change;
- WordPress extension modification;
- installed release-ZIP behavior.

Choose the lowest reliable test layer. Do not preserve an accidental bug without deciding whether it is a compatibility contract and recording that decision.

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

Use the exact layer and naming rules from the long-term Skill. Do not duplicate them here, create empty directories, or introduce a migration-only parallel architecture.

Legacy code may temporarily call a new pure Domain function or focused Adapter to prove a seam. A compatibility bridge must be directional, narrow, typed, documented, tested, and removable.

New React Features must not import legacy modules as their long-term Domain or State owner.

## Extract Pure Logic Before UI When It Reduces Risk

Candidates include:

- title and line-ending normalization;
- Markdown transformations;
- outline parsing;
- statistics;
- Dirty calculations;
- table generation;
- category-tree shaping;
- Publish Draft normalization;
- Selection calculations;
- image candidate selection.

Rules:

- import the real TypeScript function in tests;
- do not parse source text to recover functions;
- do not execute browser Bundles in a VM to prove pure logic;
- preserve input and output semantics;
- use immutable values;
- keep React, DOM, WordPress, network, Storage, and Clipboard out of `domain/`.

## Establish Ports Before Moving UI Ownership

React Features call focused Ports, not Globals or Selectors.

A migration may build a Port and Adapter while the legacy owner remains active, allowing the legacy path to call the same seam before React consumes it. This is useful only when it reduces risk and does not create a second owner.

Port rules remain those of the main Skill:

- one responsibility per Port;
- intent-named methods;
- Commands and Queries separated semantically;
- immutable snapshots;
- typed expected results;
- `AbortSignal` for cancellable work;
- idempotent unsubscribe functions;
- WordPress shapes contained inside Adapters;
- no generic `execute(type, payload)` or universal `WordPressService`.

## Ownership Ledger

Maintain an ownership ledger in the linked Issue or PR:

| Behavior | Legacy owner | Target owner | Activation condition | Removal gate | Status |
| --- | --- | --- | --- | --- | --- |
| Preview scheduling | `preview.js` | `features/live-preview` | React Root ready and `PreviewPort` valid | E2E, stale cancellation, no duplicate scheduler | characterized |
| Publish Dialog | legacy module | `features/publishing` | capability and native fields validated | publish/update/schedule tests and zero hidden writes | discovered |

Allowed status values:

```text
discovered
characterized
seam-ready
shadow-read
react-ready
react-active
legacy-deprecated
legacy-removable
legacy-removed
verified
```

Do not mark a unit `react-active` until its activation condition is observable in production behavior.

## One Active Owner and No Dual Writes

Every state-changing behavior has exactly one active owner.

Prohibited duplicate owners include:

- Save handlers;
- Publish handlers;
- Preview schedulers;
- Local Draft timers;
- shortcut managers;
- Media insertion handlers;
- Clipboard exporters;
- canonical document sources;
- native-field writers.

Read-only comparison is allowed only when it has no visible side effect, protected duplicate request, persistence, or user-facing result, and when it has a finite removal date.

Dual write is prohibited.

## Migration Sequence

Prefer this sequence, adjusting only with evidence recorded in the focused Issue:

1. discover the real current contract;
2. characterize success and failure behavior;
3. extract pure Domain behavior where useful;
4. create or reuse focused Contracts, Ports, and Adapters;
5. implement the React owner behind an explicit activation boundary;
6. validate React readiness without state-changing shadow execution;
7. atomically transfer ownership;
8. deprecate and remove the superseded owner after gates pass;
9. remove temporary seams and update durable documentation.

Do not measure progress by converted file count.

## Atomic Activation

Use an explicit ownership handoff:

```text
validate Bootstrap and capability
→ create Runtime and Root Store
→ mount React
→ verify ready state and required Ports
→ activate React owner marker
→ detach only the superseded legacy owner
```

Rules:

- do not hide or detach the legacy owner before React readiness;
- do not detach unrelated behavior;
- activation is idempotent and testable;
- DOM presence alone does not prove ownership;
- failure before activation preserves the legacy owner;
- failure after activation follows the written rollback contract;
- React and legacy paths never both execute the same state-changing action.

## Rollback

Define rollback before activation.

Rollback may restore the previous owner only when:

- the old implementation still exists;
- restoring it cannot create dual ownership;
- State can be synchronized safely;
- no protected write partially completed;
- the user receives an honest failure message.

For destructive or irreversible operations, fail before activation or provide an explicit recovery contract. Do not silently fall back and pretend the React path succeeded.

## Preserve WordPress and Data Authority

Every migration retains:

- `_easymde_markdown` as canonical Markdown;
- `post_content` as sanitized compatibility output;
- PHP `MarkdownRenderer` as formal Renderer;
- WordPress authority for capabilities, nonces, Meta, Revisions, Media, Taxonomies, Save, Publish, Status, Locks, Autosave, Scheduling, Settings, and public output;
- zero-write opening for ordinary supported Posts;
- native Save and Publish behavior;
- extension Registries, public Facade, Route namespace, IDs, handles, ordering, and documented events.

Native-field rules:

- synchronize accepted transactions before native serialization;
- never Debounce the Submission Bridge;
- do not treat field synchronization as persisted success;
- observe the actual WordPress result;
- never Force-click disabled or missing native controls;
- preserve Heartbeat, Locks, Authentication, Nonce refresh, Dirty and unload behavior;
- stop protected writes when capability, authentication, or lock state is lost;
- retain unsaved session content when safe.

## Migration Testing Matrix

Use the long-term Skill for test-layer rules. Migration work must additionally prove ownership transfer.

### Before activation

- current behavior is characterized;
- Bootstrap and Port contracts are validated;
- React can mount and become ready;
- legacy behavior remains the only state-changing owner;
- failure before readiness preserves the legacy owner.

### During activation

- React readiness is observable;
- only the intended legacy owner detaches;
- no duplicate Listener, Timer, Observer, request, or native-field writer exists;
- no hidden save or revision occurs;
- activation is idempotent.

### After activation

- React is the sole owner;
- success, failure, cancellation, conflict, stale completion, and teardown work;
- Focus, keyboard, IME, Selection, Undo, Scroll, responsive layout, RTL, and accessibility remain correct;
- protected normal-mode and unrelated WordPress Admin surfaces remain unchanged;
- installed release ZIP behavior passes;
- rollback behavior is either proven or explicitly no longer required.

Green unit tests alone do not prove an ownership handoff.

## Browser and DevTools Evidence

For a migrated surface inspect:

- console errors and React warnings;
- Network request count, order, cancellation, status, and payload boundary;
- duplicate Event Listeners;
- MutationObserver and Timer cleanup;
- active element and Focus return;
- Portal and Scroll Lock cleanup;
- Selection, IME, Undo, and Scroll preservation;
- layout, overflow, and stacking;
- disabled and pending controls;
- Memory and listener counts after repeated lifecycle;
- plugin subdirectory and non-default Plugin URL behavior when assets change.

Use deterministic synthetic content. Do not publish HAR files, screenshots, traces, Storage, or logs containing private article content, Nonces, Cookies, credentials, local paths, or private endpoints.

## Performance During Migration

Record a baseline before changing ownership. Measure only relevant scopes:

- large-document typing latency;
- Preview scheduling and completion;
- mount-to-ready time;
- Toolbar and Dialog interaction;
- Outline and Revision rendering;
- Memory after repeated mount and unmount;
- Listener, Observer, and Timer counts;
- entry and optional chunk size;
- duplicate dependencies and private React inclusion.

A migration is not an optimization merely because code moved to React. Do not introduce broad memoization, Virtualization, Workers, `content-visibility`, or a performance library without measured need and focused tests.

## Deprecation Lifecycle

Every superseded owner moves through explicit states:

### Active

The legacy behavior is the production owner.

### Deprecated

A replacement exists or is planned, but the legacy owner may still be active. New code must not expand its responsibility.

### Blocked for new use

No new Feature may depend on the legacy contract except a documented compatibility bridge.

### Removable

All removal prerequisites pass and no supported consumer requires the owner.

### Removed

Code, CSS, events, selectors, Bootstrap data, tests, comments, and documentation are deleted or intentionally retained as public contracts.

Do not leave dead modules, CSS, selectors, or compatibility comments after removal.

## Compatibility Shims

A shim is allowed only when it has:

- one named compatibility purpose;
- a documented consumer;
- typed input and output;
- no new business logic;
- no hidden write;
- no silent fallback;
- a focused test;
- a removal Issue or explicit removal gate;
- a finite lifetime.

A shim may adapt shape or lifecycle. It must not become another authority or a permanent “temporary” bridge.

## Legacy Removal Gate

Remove a legacy owner only after all relevant conditions pass:

- current behavior is characterized;
- React owner is active and observable;
- a single-active-owner assertion exists;
- success, failure, cancellation, stale result, conflict, and teardown are covered;
- native Save/Publish and zero-write behavior remain correct;
- WordPress 6.7 and latest supported WordPress pass;
- accessibility and interaction evidence exists;
- release ZIP behavior passes;
- protected extension contracts are preserved;
- no current consumer imports, calls, listens to, queries, or styles the legacy owner;
- rollback is no longer required or is provided by the new owner;
- the linked Issue explicitly authorizes removal;
- the exact diff is reviewed.

Search before deletion for script handles, selectors, events, CSS classes, Bootstrap fields, tests, documentation, build scripts, Registry entries, and extension references.

## CSS Removal Gate

Before deleting legacy CSS:

- prove no retained PHP Template, public page, normal editor mode, extension, fallback, or legacy owner uses the selector;
- confirm replacement styles are scoped under the correct Root;
- compare computed styles and layout for changed and protected surfaces;
- verify Focus, Hover, Active, Disabled, Error, long-content, RTL, Zoom, and responsive states;
- confirm the release ZIP contains replacement assets;
- remove stale variables, animations, icons, preload references, and duplicate rules.

Do not delete CSS only because one visible React path looks correct once.

## Extension Compatibility

Before migration or removal inventory:

- public Facade methods;
- WordPress Actions and Filters;
- REST namespace and Routes;
- Toolbar Registry;
- Shortcode Helpers;
- Theme, Code Theme, and Custom CSS IDs;
- Script Handles;
- documented DOM Selectors;
- Event names;
- ordering and collision behavior.

Keep identifiers stable unless the linked Issue explicitly changes the public contract and defines deprecation. Never execute arbitrary JavaScript strings from extension data.

## Failure and Observability

Migration failures must be diagnosable without leaking content.

Stable diagnostics may include:

- Feature and migration unit;
- old and new owner;
- Operation ID and Request ID;
- Post ID when appropriate;
- Contract Version;
- failure Code;
- activation State.

Exclude Markdown, Titles, Excerpts, Custom CSS, prompts, model output, Cookies, Nonces, Tokens, credentials, private endpoints, local paths, and raw responses.

Do not swallow a failure to preserve the appearance of a successful migration.

## Commit, CI, and Review Discipline

For each focused migration Issue:

1. start from the current target branch;
2. keep the diff limited to one migration unit;
3. stage explicit paths only;
4. inspect working, staged, and committed diffs;
5. run tests that exercise the changed owner and protected surfaces;
6. run local read-only review when available;
7. push and observe CI for the exact Head SHA;
8. investigate failures before rerunning;
9. request Bot review only after current-Head required CI passes and only with the repository template;
10. do not merge or close the Issue without human maintainer authorization.

Do not use empty commits or unrelated formatting to retrigger CI.

Review the exact diff for:

- specification completeness;
- current-owner accuracy;
- one active owner and no dual writes;
- no hidden saves;
- correct target placement and dependency direction;
- typed Ports and runtime schemas;
- React purity, State ownership, and Effect discipline;
- WordPress capability, nonce, Lock, Autosave, Revision, Media, and Publish behavior;
- extension compatibility;
- stale-result, cancellation, and lifecycle cleanup;
- Focus, keyboard, IME, Selection, Undo, and Scroll;
- responsive, RTL, contrast, and visual fidelity;
- performance evidence;
- release ZIP inclusion and exclusion;
- diagnostics redaction;
- removal gate;
- honest unverified areas.

## Migration Unit Completion

A migration unit is complete only when:

1. the specification and ownership ledger are current;
2. the target owner is active under an explicit condition;
3. no duplicate state-changing owner remains;
4. success and relevant failure paths are tested;
5. protected WordPress and EasyMDE contracts remain intact;
6. browser and accessibility evidence is complete;
7. performance claims have measurements;
8. legacy code is retained with a documented reason or removed through the gate;
9. build and installable-package checks pass;
10. review findings are resolved or answered with evidence;
11. remaining risks and unverified areas are reported.

## Final Migration and Skill Deletion

The overall migration is complete only when:

- every capability tracked by Issue #74 has a final documented owner;
- no production state-changing behavior has both legacy and React owners;
- no required React Feature depends on legacy browser modules as Domain or State owner;
- superseded JavaScript, CSS, selectors, events, Timers, Observers, Adapters, Bootstrap fields, and shims are removed;
- intentionally retained compatibility contracts are documented in long-term files;
- all migration Issues are resolved by human decision;
- WordPress 6.7 and latest supported WordPress validation pass;
- TypeScript, React, PHP, Node, release, Plugin Check, and Playwright checks pass;
- accessibility, browser, lifecycle, failure, performance, and visual evidence is complete;
- the editor remains usable and public PHP rendering remains unchanged;
- no open task requires this Skill.

Delete `.agents/skills/easymde-migration/SKILL.md` only through a dedicated Issue and PR.

Before deletion:

1. move every durable rule still needed into `docs/REACT_DESIGN_PHILOSOPHY.md` or `.agents/skills/easymde/SKILL.md`;
2. remove migration-only references from open Issues, PR templates, documentation, and automation;
3. confirm no workflow requires this Skill;
4. validate the exact removal diff and installable ZIP;
5. record final migration evidence;
6. obtain explicit human maintainer approval.

Do not retain this Skill indefinitely “just in case”.

## Prohibited Migration Patterns

Do not:

1. perform a big-bang conversion;
2. create the entire target tree before real code needs it;
3. migrate by file count instead of behavior ownership;
4. allow dual writes or duplicate state-changing handlers;
5. hide the legacy owner before React readiness;
6. use silent fallback or fake success;
7. force-click disabled native controls;
8. replace native WordPress Save or Publish;
9. add a browser formal Markdown Renderer;
10. bundle a private React runtime;
11. place WordPress access inside Components;
12. introduce Next.js, RSC, Server Actions, Webpack, Gutenberg replacement behavior, or a generic CRUD architecture;
13. use a universal Adapter or stringly typed command bus;
14. preserve legacy code without consumers or a documented compatibility purpose;
15. delete legacy code before reference, behavior, package, and extension checks;
16. change visual design outside the linked migration contract;
17. claim performance, security, accessibility, browser, or compatibility success without evidence;
18. publish private browser artifacts or diagnostics;
19. keep this temporary Skill after its deletion gate passes.
