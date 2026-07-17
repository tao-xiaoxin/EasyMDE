---
name: easymde-migration
description: Use this temporary skill when planning, implementing, reviewing, or validating the transfer of an existing EasyMDE browser-side behavior from legacy JavaScript or DOM-driven ownership to the React, TypeScript, and Vite architecture. It governs characterization, typed seams, single-owner activation, rollback, deprecation, legacy removal, and migration evidence; do not use it for ordinary React feature work that has no legacy owner.
---

# EasyMDE Browser Migration Guide

This is a temporary execution Skill for transferring existing browser-side EasyMDE behavior. Closed Issue #74 is the historical umbrella plan and acceptance inventory; it is not an active ownership ledger or proof that any migration unit is complete. Every future unit uses its current focused Issue and pull request. Use the long-term .agents/skills/easymde/SKILL.md for normal React development and docs/REACT_DESIGN_PHILOSOPHY.md for stable architecture decisions.

Delete this Skill after the full migration and its removal gate are complete. Do not preserve migration ceremony as permanent project architecture.

Closed Issue #78 records the introduction of this temporary Skill and its deletion gate; it is not the future removal tracker. When the gate eventually passes, create a new focused removal Issue and pull request, and delete the Skill only after explicit human maintainer approval. Closure of #74 or #78 is historical workflow state, not migration readiness, ownership, or removal evidence. A historical umbrella Issue cannot override newer merged project contracts unless a current focused task records an explicit human maintainer decision.

Keep the three guidance files distinct:

| File | Lifetime | Responsibility |
|---|---|---|
| `docs/REACT_DESIGN_PHILOSOPHY.md` | Long-term | Stable architecture, ownership, directory, dependency, runtime, build, and package decisions |
| `.agents/skills/easymde/SKILL.md` | Long-term | Normal React and TypeScript implementation, quality, WordPress integration, testing, and maintenance |
| `.agents/skills/easymde-migration/SKILL.md` | Temporary | Characterization, ownership handoff, rollback, deprecation, legacy removal, and final migration proof |

When a migration discovers a durable rule, update its long-term owner instead of growing this temporary Skill.

## Authority and conflict order

Apply guidance in this order:

1. Explicit current-task instructions and human maintainer decisions.
2. The live repository and root AGENTS.md.
3. The current focused Issue and pull request, interpreted within the first two authorities.
4. docs/REACT_DESIGN_PHILOSOPHY.md and .agents/skills/easymde/SKILL.md.
5. This migration Skill.
6. Official React, WordPress, and TypeScript documentation and source matching the supported versions.
7. Available companion Skills.
8. Secondary articles and search results.

Stop and ask when a proposed ownership, public contract, dependency, data migration, or deletion conflicts with a higher authority. Do not resolve a material conflict by inventing a compatibility path.

## Companion Skill orchestration

Use the smallest applicable set for the current migration unit. Read a named Skill before following it, and report unavailable Skills honestly.

- spec-driven-development: define the unit, invariants, failure behavior, commands, boundaries, and acceptance evidence before implementation.
- deprecation-and-migration: inventory consumers, plan compatibility, track deprecation, and prove zero remaining use before deletion.
- frontend-ui-engineering: preserve the approved visual system, responsive behavior, interaction states, and component ownership.
- test-driven-development: add characterization or failing behavior tests before changing ownership, then work red, green, and refactor.
- browser-testing-with-devtools: inspect real DOM, accessibility, console, network, geometry, lifecycle, and performance when the browser tooling is available.
- security-and-hardening: threat-model trust boundaries, untrusted Markdown and HTML, REST, media, custom CSS, storage, clipboard, and AI output.
- wp-plugin-development: preserve WordPress hooks, capabilities, nonces, Settings API, native forms, media, packaging, and PHP authority.
- performance-optimization: measure before and after; optimize only a demonstrated bottleneck and guard the result.
- code-review-and-quality: perform a skeptical correctness, simplicity, architecture, security, performance, test-validity, and privacy review.
- vercel-react-best-practices: apply React 18 client-rendering, re-render, async, listener, and bundle guidance that fits EasyMDE.
- vercel-composition-patterns: use explicit variants, narrow providers, state ownership, and composition where they reduce real complexity.
- web-design-guidelines: review semantics, keyboard, focus, forms, feedback, motion, internationalization, and interaction quality.

Project-specific limits override generic advice:

- Do not create generic `tasks/plan.md`, `tasks/todo.md`, or another standalone migration specification solely because a companion Skill defaults to those paths. Keep the focused specification and ownership ledger in the linked Issue or pull request unless the task explicitly authorizes a repository artifact with a durable owner.
- Do not apply Next.js, RSC, Server Actions, hydration, React 19-only APIs, next/dynamic, React.cache, or framework-server rules.
- Do not introduce SWR, React Query, Zustand, Redux, a router, a form library, a schema library, or a component system merely because a companion Skill uses it.
- Do not inherit a companion WordPress Skill's newer version floor. EasyMDE's supported baseline remains WordPress 6.7 and PHP 7.4; verify every proposed API against that project matrix and WordPress 6.7 source.
- Do not let generic mobile-first breakpoints, URL-synchronized UI state, automatic retries, optimistic writes, backdrop closing, theme detection, or Core Web Vitals replace the approved editor contract.
- Do not add a router, remote CDN, preconnect, remote font, or fixed virtualization threshold from generic Web guidance; WordPress owns navigation, runtime assets stay local, and performance decisions require project evidence.
- Do not add duplicate keyboard activation handlers to native buttons or links merely because a generic checklist asks for handlers on every interactive element; custom widgets must implement the complete applicable WAI-ARIA keyboard pattern.
- Do not treat a generic security checklist as authority to add or change site-wide CSP, HSTS, frame, or other response headers during a browser ownership transfer; such host-wide policy requires its own focused Issue and WordPress compatibility review.
- Preserve repository-owned translated copy and WordPress i18n behavior; do not apply generic capitalization, punctuation, or wording rules mechanically.
- Do not optimize with memo, useMemo, useCallback, virtualization, workers, content-visibility, or code splitting without a measured need and verified accessibility and packaging behavior.
- Treat storage access, parsing, quota, and schema failures as explicit documented states. Never swallow them into fake success or use browser storage as fallback persistence for article content.

## Non-negotiable migration invariants

- _easymde_markdown remains the canonical Markdown source.
- post_content remains sanitized WordPress compatibility output.
- PHP MarkdownRenderer remains the only formal Markdown renderer.
- WordPress and PHP retain permissions, nonces, post meta, revisions, media, taxonomies, save, publish, scheduling, post status, locking, settings, supported-post admission, and public rendering.
- Opening an ordinary supported post remains a zero-write operation.
- Cancellation, opening, closing, focusing, previewing, mounting, and unmounting perform no hidden save or migration write.
- React uses the WordPress-provided React 18 runtime for WordPress 6.7 or newer.
- Public extension APIs, filters, route namespace, command registries, theme identifiers, metadata, and native submission behavior remain compatible unless an explicit maintainer decision in the current focused task approves a compatibility plan.
- Runtime assets stay local. The installable ZIP contains required compiled assets and excludes frontend source, tests, source maps unless approved, .agents, docs-only architecture material, caches, logs, and development files.
- Every state-changing behavior has exactly one active owner.
- The WordPress edit form remains an open compatibility surface. Native and extension-owned fields, controls, meta boxes, submit hooks, and unknown form data remain owned by WordPress or their registering extension unless the focused migration unit explicitly delegates one field to React.

## Define one migration unit

A migration unit is one user-observable capability with one ownership handoff, not one legacy file and not an entire screen.

Good units include:

- opening and closing one appearance panel;
- selecting and applying one theme;
- requesting and displaying live preview;
- inserting media at the preserved selection;
- editing a publish draft and invoking native publish;
- listing and restoring revisions;
- persisting one layout preference;
- exporting the stable preview to WeChat.

Do not mix a visual redesign, public API change, data-model change, dependency experiment, or unrelated cleanup into the ownership transfer. Create a separate Issue when the user-visible contract changes.

Before implementation, record in the linked Issue or PR:

- user problem and observable success;
- current owner and intended owner;
- input, state transition, side effects, output, and failure path;
- canonical persisted state and browser-session state;
- DOM fields, selectors, events, timers, observers, storage keys, REST routes, WordPress globals, and assets touched;
- extension and protected-surface consumers;
- activation signal and rollback boundary;
- removal candidates and proof required before deletion;
- security, accessibility, performance, browser, release, and privacy evidence;
- known unverified states.

Do not proceed if the current owner cannot be identified. Add privacy-safe diagnostics or characterization tests first.

Maintain one ownership ledger in the current focused Issue or pull request:

| Behavior | Current owner | Intended owner | Activation condition | Removal evidence | Status |
|---|---|---|---|---|---|

Use only evidence-backed states: `legacy-active`, `characterized`, `seam-ready`, `react-active`, `legacy-removable`, `legacy-removed`, and `verified`. A status does not advance because files exist; its activation or removal evidence must already pass.

These are durable work-progress states. The `react-initializing` and `react-ready` names used below describe transient runtime handoff states, not extra ledger statuses. Record their proof in the ledger's activation condition and linked test evidence; do not add process states merely to mirror every runtime instant.

## Inspect and characterize the current owner

Inspect the live path rather than relying on this list:

    assets/js/admin/bootstrap.js
    assets/js/admin/immersive-workspace.js
    assets/js/admin/editor-state.js
    assets/js/admin/commands.js
    assets/js/admin/preview-client.js
    assets/js/admin/preview-feature-loader.js
    assets/js/admin/theme-manager.js
    assets/js/admin/toolbar.js
    assets/js/admin/draft-storage.js
    assets/js/admin/media-picker.js
    assets/js/admin/image-paste.js
    assets/js/admin/wechat-exporter.js
    assets/css/admin/
    src/Admin/
    src/Content/
    src/Rest/
    src/Theme/
    templates/admin/
    tests/

Build an owner inventory for the selected behavior:

- initialization and teardown entrypoints;
- reads and writes;
- mutable state and saved baseline;
- listener, timer, observer, pointer capture, selection, focus, and scroll ownership;
- request cancellation and stale-result handling;
- external-store snapshots, subscriptions, polling, and cleanup;
- async operation concurrency and authoritative-result reconciliation;
- loading, empty, success, error, permission, conflict, and unavailable states;
- PHP bootstrap strings, JS literals, text domains, extraction roots, catalogs, and status announcements;
- PHP capability, nonce, sanitization, escaping, and persistence path;
- local asset and release-package path;
- current unit, integration, browser, and negative tests.

Characterization tests protect intentional behavior, including awkward compatibility behavior. Do not freeze an accidental implementation detail unless a consumer or project contract depends on it.

## Write the focused specification

The migration specification must state:

    Unit:
    Current active owner:
    Intended active owner:
    User-visible invariant:
    Protected surfaces:
    Persisted authority:
    Browser-session owner:
    Typed seam:
    Activation readiness:
    Rollback boundary:
    Failure and cancellation behavior:
    Async concurrency and authoritative-result policy:
    External-store subscription contract:
    Translation and status-message impact:
    Removal gate:
    Verification commands:
    Unverified areas:

The specification is accepted only when the current focused Issue defines the unit within higher-priority repository contracts and all material open questions are resolved. Update it before code when evidence changes the intended boundary.

## Establish controlled baseline evidence

Before changing ownership:

1. Use deterministic synthetic content, permissions, post state, viewport, locale, direction, zoom, font, and browser state.
2. Capture the changed surface and every protected surface that could regress.
3. Wait for fonts, images, preview, local assets, and async work before measuring.
4. Record DOM order, accessibility tree, focus, selection, scroll, geometry, computed styles, network calls, console output, and writes relevant to the unit.
5. Exercise success, cancellation, rejection, missing dependency, stale completion, rapid repeat, teardown, and re-entry paths.
6. Record a performance baseline only for metrics the unit can affect.

Screenshots alone are insufficient. Source-text assertions alone are insufficient. A dev-server result does not prove the release ZIP.

## Build seams before moving ownership

Map responsibilities into the approved structure:

- pure rules and transformations to domain;
- bootstrap, result, error, safe-value, and Port contracts to contracts;
- WordPress DOM, native form, REST, media, storage, clipboard, and preview enhancement to integrations;
- user-recognizable behavior to features;
- root composition and ownership activation to entrypoints and app;
- generic primitives with no EasyMDE or WordPress semantics to shared.

The mapping is responsibility-based. Do not create one new TypeScript file for every old JavaScript file.

Test extracted pure TypeScript rules through direct imports. Do not recover functions with source-text regular expressions or execute an entire browser bundle in a VM merely to test logic that now has a real module boundary.

Create the narrowest Port that represents one external responsibility. Keep queries and commands conceptually separate. Use typed results for expected cancellation, validation, permission, conflict, unavailable, and stale outcomes. Use exceptions for programmer defects and exceptional infrastructure failures.

Validate PHP, REST, bootstrap, extension, storage, and build-manifest values at runtime. TypeScript declarations alone do not validate external data.

When the unit reads changing WordPress, legacy, or browser state, define a focused `useSyncExternalStore` adapter before handoff. Prove stable subscription, immutable cached snapshots, idempotent cleanup, repeated mount safety, and owner-identity reset; do not bridge external state with polling or Effect mirroring.

Declare each async operation as latest-wins, single-flight, parallel-keyed, or ordered. Preserve that policy across handoff, bind results to their owner identity, and do not report a WordPress mutation as cancelled merely because browser observation was aborted.

Do not create:

- a universal EditorAdapter or WordPressService;
- generic execute(type, payload) commands;
- a string event bus;
- a shared mutable root store;
- Feature imports of concrete WordPress adapters;
- component access to window.EasyMDEConfig, jQuery, wp.apiFetch, wp.media, WordPress selectors, storage, or clipboard;
- browser-side formal Markdown or CSS security parsers.

When useful, let the legacy owner consume the new pure rule or focused Port first. This proves the seam without giving two owners permission to mutate the same state.

## Implement the replacement with TDD

For behavior changes:

1. Add a test that fails because the replacement behavior or seam is absent.
2. Implement the smallest correct slice.
3. Keep the current owner active until the replacement is ready.
4. Refactor only with the focused tests green.
5. Run protected-surface tests after each ownership change.

Test outcomes, not the internal sequence of React calls. Prefer real pure functions and adapters, then fakes, then stubs; mock only expensive or unsafe boundaries.

Required test layers as applicable:

- domain tests for pure rules and edge cases;
- contract tests for schemas, versions, errors, and PHP/TypeScript fixtures;
- adapter tests for native DOM, nonce refresh, locks, REST, media, storage, clipboard, external-store snapshots and subscriptions, cancellation, and cleanup;
- component tests for accessible user behavior, status announcements, and honest Error Boundary scope through a mock runtime;
- app tests for readiness, activation, Error Boundaries, teardown, and any Providers or Root Stores the migrated Root actually owns; do not introduce test-only infrastructure for structural symmetry;
- Playwright tests against an installed release ZIP for the real WordPress flow;
- release tests for compiled inclusion and development-file exclusion.

## Transfer ownership atomically

Use this lifecycle:

    legacy-active
    → react-initializing while legacy remains active
    → react-ready after contracts, dependencies, and required DOM validate
    → atomic handoff: detach legacy state-changing owners, then activate React
    → react-active

Rules:

- Do not hide or detach the legacy owner before React readiness.
- Mount React into a dedicated, initially empty container delegated exclusively to that Root. Keep legacy, WordPress, and extension DOM that must remain usable outside it; never call `createRoot` on a container whose existing children must survive the first render.
- Preflight and read-only initialization occur before ownership handoff. Legacy code must not remove, replace, or write inside the active React container, and React must not mutate legacy-owned DOM before the handoff contract delegates it.
- Readiness means required contracts, permissions, DOM bridges, adapters, and assets are usable; mount success alone is insufficient.
- During initialization, React may prepare read-only state but must not register competing mutations.
- Define one explicit handoff commit point. Preflight every operation that can fail before it; the detach/activate critical section must not perform new asynchronous work or leave a state in which neither owner is usable.
- At handoff, remove old listeners, schedulers, timers, observers, pointer captures, and write paths owned by the unit.
- Switch external-store subscribers at the same handoff; leave no duplicate subscription, polling loop, or stale snapshot source.
- Do not run two preview schedulers, draft timers, shortcut managers, save observers, publish handlers, media handlers, clipboard exporters, or storage writers for the same behavior.
- DOM presence is not ownership proof. Track ownership explicitly.
- After handoff, do not silently reactivate legacy code inside the same session after partial state changes.
- Error Boundaries do not catch event, Promise, timer, Port, or mutation failures; those paths require typed results, explicit state, diagnostics, and the written rollback contract.
- Startup failure before handoff keeps the legacy owner usable and surfaces an explicit diagnostic; it is not silent fallback.
- If activation fails after legacy detachment but before any React mutation, restore the legacy owner synchronously and report the failure. After a React mutation can have occurred, do not live-switch writers; preserve recoverable session data and use the documented reload/remount rollback.
- Rollback selects one implementation before activation, normally through a clean reload or remount. It does not live-switch writers mid-operation.
- A feature flag or compatibility switch requires a linked Issue, explicit owner semantics, release testing for both paths, and a deletion date or removal condition.

Shadow comparison is allowed only for read-only, privacy-safe results. Never shadow save, publish, restore, upload, settings, custom CSS writes, or other mutations.

## Preserve editing and WordPress behavior

For editing surfaces, verify:

- selection start, end, and direction;
- IME composition and shortcuts;
- undo and redo grouping;
- focus entry and return;
- source and preview scroll;
- clipboard and drag/drop;
- pointer cancellation and lost capture;
- editor instance identity across normal renders;
- native submission bridge freshness before save, autosave, publish, or unload checks.

For WordPress operations:

- PHP rechecks capability and nonce for every protected action;
- current REST nonce and post-lock state can change after bootstrap;
- missing, disabled, replaced, or extension-modified native controls fail preflight clearly;
- React mutates only fields explicitly delegated by the migration specification and lets WordPress serialize the complete native form; it must not replace submission with a closed TypeScript allowlist that drops unknown native, meta-box, or extension-owned values;
- cancelling a UI draft before its authoritative Mutation begins produces zero writes; aborting browser observation of an in-flight WordPress Mutation does not prove that the server write was cancelled;
- mutations do not auto-retry;
- success follows the real WordPress result, not an optimistic browser state;
- lock, authentication, capability, or nonce loss prevents new protected Mutations, preserves unsaved content, and reports the reason; an already-started Mutation still follows its declared cancellation and authoritative-result reconciliation policy;
- scheduling uses the WordPress site timezone;
- revision restore follows the server-owned revision kind: EasyMDE revisions restore Markdown and appearance and use newly rendered compatibility HTML only when PHP rendering succeeds; the unavailable/failure path uses stored revision HTML without generating a new signature, while any signature stored on the revision is restored and remains subject to normal validation against the restored Markdown, article theme, and compatibility HTML;
- restoring a pre-EasyMDE revision removes current EasyMDE document-state metadata and restores historical HTML; the browser does not fabricate Markdown or assume the post remains an EasyMDE document-state post.

## Apply React 18 and composition guidance selectively

- Keep render and Hooks pure.
- Put user actions in event handlers and external synchronization in focused Effects with idempotent cleanup.
- Store minimal state; derive values during render or in pure selectors.
- Use discriminated unions instead of contradictory status booleans.
- Keep high-frequency Markdown and selection out of broad Context updates.
- Subscribe to the smallest store slice.
- Do not debounce controlled input or the native submission bridge; debounce preview and proven expensive derived work.
- Use functional state updates when the next value depends on the previous value.
- Use refs only for values that do not affect rendering.
- When a React 18 primitive must expose its native DOM node, use `forwardRef` from `@wordpress/element`; do not apply the companion Skill's React 19 no-`forwardRef` or ref-as-a-Prop guidance.
- Prefer explicit variants over boolean mode combinations.
- Use compound components only for one cohesive control with real shared scoped state.
- Use children for structural composition; use render functions only when callers need live internal state.
- Do not add memoization by default. Measure re-renders and identity costs first.
- Do not wrap document input, native-field synchronization, save, publish, focus, or accessibility-critical state in a transition.
- Lazy-load only optional heavy UI when the selected WordPress script format and release manifest support it.

## Security and privacy gate

Threat-model each changed boundary:

- untrusted Markdown and rendered HTML;
- REST and bootstrap data;
- media files and URLs;
- custom CSS;
- extension data;
- browser storage and clipboard;
- translated strings;
- AI prompts and model output;
- diagnostics and public review artifacts.

Verify server-side validation, capability, nonce, payload limits, sanitization, escaping, same-user custom CSS access, and no remote runtime dependency. React escaping does not make dangerouslySetInnerHTML safe; only the formal sanitized preview contract may enter the preview-owned HTML sink.

Never log article content, custom CSS, prompts, nonces, credentials, private endpoints, browser storage, or raw server errors. Use operation IDs, stable error codes, durations, feature names, owner state, and privacy-safe context.

## UI, accessibility, and visual fidelity gate

Preserve the approved reference and protected normal surfaces. The project UI design fidelity workflow overrides generic aesthetic defaults.

Verify:

- semantic controls and accessible names;
- keyboard order, focus containment and return, Escape, and safe backdrop behavior;
- labels, descriptions, validation, pending, error, success, and disabled semantics;
- long text, translation, RTL, zoom, text scaling, reduced motion, forced colors, and high contrast;
- selection, IME, undo, focus, scroll, pointer, touch where applicable, and repeated lifecycle;
- exact local fonts, icons, theme assets, stacking, overflow, and responsive breakpoint behavior;
- zero console errors and warnings introduced by the unit.

Do not restyle a protected surface to simplify the handoff. Do not accept a screenshot threshold increase as a fix for deterministic divergence.

## Performance and package gate

Measure before and after when the unit can affect performance:

- large-document typing latency;
- preview request and enhancement latency;
- render and commit cost;
- mount and readiness time;
- repeated open/close memory and listener count;
- request count and waterfalls;
- initial and optional bundle size;
- local asset loading.

Define task-specific tolerances before seeing the result. Core Web Vitals do not replace editor interaction metrics. If no representative measurement is available, report performance as unverified rather than claiming improvement.

Build and test the production output. Verify WordPress-provided React is not duplicated, dependency metadata matches imports, asset URLs work outside the default plugin path, runtime assets are local, and the installable ZIP includes every required entry and chunk while excluding development files.

Also verify the source ZIP / tar.gz is built from the exact tracked commit, contains the tracked `frontend/` source and required build guidance, preserves any required compiled runtime output intentionally tracked by repository policy, and rejects the generated or local-only artifacts disallowed by the source-archive builder. Do not reuse the installable ZIP allowlist for the source archive.

## Deprecate and remove the old owner

Move a superseded owner through explicit states:

```text
active
→ deprecated (no new responsibilities)
→ removable (all deletion evidence passes)
→ removed (owned code and references are gone)
```

Do not label an owner deprecated merely to postpone unresolved consumers, ownership, or failure behavior. Mark the old owner superseded only after the replacement is active and verified. A compatibility shim must have:

- a named consumer and owner;
- the exact public or release contract it preserves;
- tests proving delegation and failure behavior;
- observability for remaining use when privacy-safe;
- a removal condition;
- no independent state or hidden write path.

Remove old code only when:

- all known consumers use the replacement;
- ownership inventory shows no legacy state-changing path;
- characterization, adapter, component, app, browser, protected-surface, and release checks pass;
- interruption, cancellation, stale completion, remount, lock, nonce, permission, and dependency failures are covered;
- relevant accessibility, visual, and performance evidence meets the predeclared contract;
- searches find no obsolete selectors, events, timers, storage keys, bootstrap fields, assets, tests, docs, or package entries;
- retained templates, normal editor surfaces, public output, extensions, and fallbacks no longer consume legacy CSS or DOM contracts; replacement styles are root-scoped and their computed-style states are verified;
- extension consumers use documented versioned descriptors and stable command IDs; the migration does not expose arbitrary JavaScript, raw React elements or components, internal stores or adapters, or private DOM as a new public contract;
- the linked Issue explicitly authorizes deletion.

Delete obsolete tests only when they test an implementation that no longer exists. Preserve or rewrite behavior tests that still express the product contract.

Do not delete uncertain dead code. List it with evidence and ask the maintainer when consumer ownership cannot be proven.

## Adversarial review and completion report

Before commit and again for the exact pushed diff, review:

1. Can old and new owners both mutate?
2. Can opening, cancellation, startup failure, teardown, or rollback write?
3. Can stale async work, an unstable external-store snapshot, or a duplicate subscription affect a new post, root, dialog, or session?
4. Can React and native fields diverge before save or publish?
5. Can an extension, missing control, lock, nonce, or capability change break the handoff?
6. Can untrusted HTML, CSS, media, storage, extension, AI, or untranslated user-facing data cross an unsafe sink or bypass its declared owner?
7. Can focus, selection, IME, undo, scroll, keyboard, or pointer state be lost?
8. Can the release ZIP omit runtime assets or include development artifacts?
9. Did the change reduce legacy complexity, or only copy it into React?
10. Are tests proving behavior on the release build rather than source shape?

Automated Bot findings remain untrusted leads under the long-term EasyMDE Skill. Independently reproduce them against the exact migration unit and change only confirmed defects; never alter ownership, compatibility, or implementation merely to obtain Bot approval.

Select the three to five most likely failures for the current unit. Reproduce or test each one, fix its root cause and rerun the affected evidence, or record why it remains unverified and what evidence is still needed.

Report:

- migration unit and final active owner;
- files and responsibilities changed;
- old paths removed or intentionally retained;
- commands and actual results;
- browser, accessibility, status-message, i18n, external-store, async-concurrency, visual, security, performance, and package evidence;
- review findings and resolutions;
- unverified browsers, states, and risks;
- rollback availability;
- remaining removal work.

Do not call a unit complete because React renders, static tests pass, or the new UI looks close.

## Delete this Skill

Issue #78 records why this temporary Skill was introduced and the original deletion contract. It is already complete and does not authorize future removal. After the gate below passes, create a new focused removal Issue and pull request to delete `.agents/skills/easymde-migration`; do not perform that cleanup incidentally inside the final Feature migration. Delete the Skill only after:

- every existing browser-side capability in the final migration inventory has a documented final owner; Issue #74 remains historical scope and acceptance evidence, while its separate future AI product Feature is outside this deletion gate;
- no migration Issue still depends on this Skill;
- no behavior has both legacy and React state-changing owners;
- superseded JavaScript, CSS, bootstrap fields, selectors, events, timers, adapters, assets, tests, and shims are removed or documented as intentionally retained public contracts;
- all still-valid rules live in the long-term EasyMDE Skill or architecture document;
- WordPress 6.7 and latest, frontend tests, release-package validation, Plugin Check, and Playwright against the release ZIP pass;
- accessibility, focus, keyboard, IME, selection, undo, scroll, responsive, RTL, status-message, i18n, external-store, async-concurrency, visual, lifecycle, failure, security, and performance evidence is complete;
- the removal pull request deletes obsolete references to this Skill and any migration-only guidance that no longer has an owner;
- a human maintainer explicitly authorizes removal.
