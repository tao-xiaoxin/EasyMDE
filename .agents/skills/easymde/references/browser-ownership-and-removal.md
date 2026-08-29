# Browser Ownership And Removal

## Contents

- [When to use](#when-to-use)
- [Owner inventory](#owner-inventory)
- [Characterization and shims](#characterization-and-shims)
- [Removal proof](#removal-proof)
- [Read-only comparison](#read-only-comparison)

## When to use

Use this reference only when a task transfers behavior, adds a compatibility
shim, deprecates or removes a browser owner, changes a shared runtime owner, or
audits a legacy path. A normal focused Feature does not require an exhaustive
inventory of unrelated behavior.

## Owner inventory

Before editing, record the current and intended owner for every affected
behavior. Trace initialization, rendering, reads/writes, mutable state and
baseline, listeners/events, timers/Observers, Pointer Capture, Selection,
Focus, Scroll, cancellation, external-store subscriptions, async concurrency,
loading/empty/success/error/permission/conflict/unavailable states, Bootstrap
fields, translation owner, assets, packages, tests, native WordPress fields,
and extension consumers.

Use this compact record for each behavior:

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
Package and release impact:
Unverified areas:
```

Presence in the DOM, a mounted Component, or a passing static check is not
ownership proof. Identify every state-changing path and the one active owner.

## Characterization and shims

Characterization tests preserve intentional user-visible and compatibility
behavior, including awkward edge cases. Test at the lowest reliable boundary
and do not freeze incidental markup unless a consumer or contract depends on
it. Keep or rewrite tests when an implementation changes but the product
behavior remains required.

A compatibility shim is removable only when it has a named owner and consumer,
the exact public/release contract it preserves, delegation and failure tests,
privacy-safe observability where useful, and an explicit removal condition. It
must not own independent state or hide a write path. A shim is not a license to
keep two successful persistence authorities.

## Removal proof

Removal requires a focused Issue and a live-code proof of zero consumers and
zero legacy state-changing/write paths. Search the complete affected set:
selectors, events, timers, Observers, Storage keys, Bootstrap fields, assets,
tests, documentation, package entries, extension hooks, and native form
integration. Search both source and generated/runtime inventories. Do not
delete uncertain dead code; record the uncertainty and obtain maintainer
direction.

After removal, verify the replacement owner, failure behavior, teardown,
public contracts, and characterization coverage. Check that no hidden fallback,
duplicate DOM, stale listener, stale async result, or package artifact remains.
Re-run protected-surface checks after the final change. Evidence from an old
base, target path set, or runtime revision is invalid after that input changes.

## Read-only comparison

Shadow comparison is allowed only for read-only, privacy-safe results. It must
not shadow Save, Publish, Restore, Upload, Settings, Custom CSS, Clipboard, or
another mutation; it must not affect the current document, native form, or
persisted state. Compare outputs without making the comparison a second owner.

For editing behavior, verify selection direction, IME, undo grouping, focus,
scroll, pointer cancellation, and Editor identity. Browser evidence must show
no new Console Error or Warning. Declare performance thresholds before a
measurement; if no representative measurement exists, report `unverified`.
