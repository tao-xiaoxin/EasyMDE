# Preview And Feature Contracts

## Contents

- [Preview pipeline](#preview-pipeline)
- [Feature boundaries](#feature-boundaries)
- [WordPress session](#wordpress-session)
- [Drafts and storage](#drafts-and-storage)
- [Failure and teardown](#failure-and-teardown)

## Preview pipeline

The Preview session owns a debounced read for the current Markdown, appearance,
and request identity. Abort superseded reads, reject stale revisions or
Markdown signatures, and render only the accepted server-sanitized HTML through
one branded Safe HTML sink. The REST Preview route and PHP Markdown renderer
remain the formal rendering authority.

Local TypeScript enhancement may add Highlight.js, KaTeX, Mermaid, TOC, the
selected code theme, and the shared code frame only after the response is
accepted. Enhancement failure keeps the sanitized response visible and reports
the real failure; it never creates a second renderer or silently changes the
source. Bound expensive post-response work for the affected Feature.

Preview state must distinguish disabled, inactive, empty, loading, success,
error, unavailable, and stale results. A stale response cannot replace the
current document or sink. Preview notifications used by background work must
identify the active sink and cannot let a hidden or disposed surface replace
the currently editable surface.

## Feature boundaries

The Editor Root composes focused Features for toolbar/commands, CodeMirror
document and title, Preview, Appearance, Fonts, Custom CSS, Media, Local Draft,
WeChat export, layout, and WordPress session state. Each Feature owns its local
state, typed Port, status transitions, and cleanup. A Feature may call another
Feature's public API, never its private implementation or Store.

For every affected Feature state:

```text
User event -> Feature owner -> typed Port -> focused Adapter
           -> authoritative result -> state/status -> accessible feedback
```

The WordPress form is an open compatibility surface. Synchronize a native or
hidden bridge only for an explicit delegated field and flush it before form
serialization; do not treat synchronization as a successful Save. Preserve
unknown extension fields, submit hooks, Meta Boxes, and native controls.

Use semantic controls and accessible names, labels, roles, keyboard behavior,
focus return, pending/disabled/error states, and user-action-driven mutations.
Do not force-click disabled controls or announce success before completion.

## WordPress session

The WordPress session Adapter observes Heartbeat authentication, REST Nonce,
Post Lock, capability, and connection state. When a protected operation is
blocked, preserve unsaved content and expose the owning unavailable, conflict,
or recovery status. The Adapter does not become a second capability or
persistence authority.

Save, Publish, Media, Custom CSS, and Revision operations report only
authoritative results. They reject unsupported Post Types, autosaves,
revisions, invalid requests, recursive Save/render paths, and stale identity
where their owning PHP contract requires it. A failed renderer or missing
Composer dependency is an explicit administrator-visible/REST failure, not
fallback HTML.

Local Draft recovery is optional recovery storage, never article persistence.
Use the live versioned identity and limits from the PHP/bootstrap contract;
preserve explicit read, write, discard, quota, corrupted-value, access-error,
and cross-tab conflict states. New-post identity comes from the stable PHP
contract, not a temporary client ID. Storage failure may use a documented
preference default, but never silently replaces WordPress content.

## Drafts and storage

When a Feature uses browser Storage, define site/user/post identity, schema
version, size limit, serialization, scheduling, conflict policy, and teardown.
Writes happen only in the explicit owning recovery/preference event. Do not
log stored values or import private content into tests or public evidence.

For external stores, subscriptions are stable, snapshots are cached, and one
subscription is cleaned up per consumer. Effects must not mirror store state
into another source of truth.

## Failure and teardown

Every Feature distinguishes pending, success, failure, cancellation, stale,
unavailable, permission, conflict, and teardown. Late results after an owner,
Post, Root, Dialog, or sink change are ignored and do not set status on a new
surface. Repeated enter/exit must not multiply handlers or retain global DOM
state.

On teardown remove listeners, Observers, Timers, Portals, Body classes, inline
styles, Pointer Capture, Selection/Focus/Scroll locks, Storage subscriptions,
and abortable browser reads. Restore native bridge visibility and temporary
DOM. Verify no hidden write occurred during cleanup.
