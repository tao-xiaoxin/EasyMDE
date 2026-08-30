# React Architecture

## Contents

- [Layering](#layering)
- [Composition and APIs](#composition-and-apis)
- [State and lifecycle](#state-and-lifecycle)
- [Packages and contracts](#packages-and-contracts)

## Layering

Use React and TypeScript with the WordPress-provided React 18 runtime. Source
belongs under `frontend/`; compiled runtime belongs under `assets/build/`.
Keep Components focused on presentation and user intent. Browser globals,
WordPress DOM, REST, `wp.media`, Storage, Clipboard, and Bootstrap data belong
to focused Integration Adapters behind typed Ports. A Port describes a real
capability, result, failure, and cancellation boundary; avoid universal
`execute(type, payload)` interfaces and generic service facades.

The normal dependency direction is:

```text
domain -> contracts -> ports -> integrations -> features -> entrypoints
```

Lower layers must not import Feature semantics. Feature-private modules are
not imported through broad barrels, upward imports, circular dependencies, or
catch-all directories. `Plugin.php` and PHP services remain outside this
browser layering; PHP/WordPress still owns persistence and authorization.

Before creating an abstraction, search for an existing EasyMDE Port, Adapter,
Feature API, Registry, WordPress API, test fixture, or build helper. Reuse it
only when ownership and semantics match. A new abstraction states its owner,
consumers, failure contract, test boundary, and removal path.

## Composition and APIs

The Editor Root composes the toolbar and command registry, CodeMirror document
and title sessions, server Preview and local enhancements, Appearance, Custom
CSS, Fonts, Media/upload, Local Draft, WeChat export, layout, and WordPress
session state. The Settings Center has a separate root. Components use typed
Props and callbacks and do not reach through them to WordPress or browser
globals.

Use the smallest complete UI capability: an existing project or WordPress
primitive first, semantic HTML second, a maintained React 18-compatible
headless primitive for a complex interaction third, and a focused project
Component only when a verified requirement remains. Evaluate focus, keyboard,
Portal, dismissal, positioning, ARIA, visual ownership, lifecycle cleanup,
license, bundle size, local delivery, and tests before adding a package. Do not
introduce a complete design system or package merely to reduce code.

Public extension descriptors are versioned and runtime-validated. Keep public
IDs and serialized field meanings stable; add a version when old consumers
cannot interpret a payload. Unknown optional fields may be ignored only when
safe. Never pass arbitrary JavaScript, private React Elements, Stores, or
Adapters through public extension data.

## State and lifecycle

Keep state minimal and single-owned. Derive values from current state in pure
selectors/render; do not mirror state in Effects, create shared mutable Root
Stores without a real owner, or reset state accidentally through nested
component definitions. Use Refs only for non-rendering transient values. An
external store needs a stable subscription, cached snapshot, one subscription
per consumer, and teardown.

Every Effect, listener, Observer, Timer, Portal, Body class, inline style,
Pointer Capture, Selection, Focus, Scroll lock, and async task has an owner and
cleanup path. Mount, unmount, re-entry, cancellation, owner change, and failure
must be safe and idempotent. Async work declares its concurrency shape, owner
identity, cancellation policy, stale-result guard, authoritative completion,
and visible pending/error outcome. Browser abort does not prove server mutation
cancellation; reconcile with the WordPress owner.

Preserve editor-specific behavior: selection start/end/direction, IME,
shortcut dispatch, undo/redo grouping, focus entry/return, source/Preview
scroll, pointer cancellation/lost capture, and Editor instance identity. User
commands do not run from render or passive Effects. Open, close, focus, preview,
cancel, fallback, and teardown never perform hidden persistence.

## Packages and contracts

Use the root package and lockfile. Keep React, ReactDOM, type declarations,
`@wordpress/element`, TypeScript, Vite, and the supported Node/browser target
aligned with WordPress 6.7 and the live package. A build is not a TypeScript
check; retain an independent `tsc --noEmit` gate. Do not bundle a private React
runtime or depend on development HMR for correctness.

For any Bootstrap, REST, Manifest, or PHP-to-TypeScript boundary, validate
shape, type, version, enum, identity, limits, and required fields before use;
preserve stable errors separately from translated messages. Do not add a schema
framework or code generator without a concrete current boundary.

Performance work keeps typing synchronous, debounces Preview and expensive
derivation, aborts obsolete reads, and measures before claiming improvement.
Do not trade correctness, accessibility, diagnostics, or stale-result
protection for a benchmark.
