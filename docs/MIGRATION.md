# EasyMDE Migration Notes

## Normal Editor Toolbar Ownership

The normal editor's main Markdown Toolbar is the first production React
migration unit. PHP `ToolbarRegistry` descriptors, command IDs, ordering,
translated labels, and shortcut configuration remain authoritative. React owns
the main Toolbar presentation, heading-menu interaction, and command intent
dispatch. A focused React command session owns the normal editor's Markdown
selection transformations after readiness, including formatting, headings,
lists, blocks, links, extension-provided prefix/suffix or line-prefix commands,
Selection direction, and Focus restoration. Its document Port follows the
active normal document owner: the native textarea before the document-session
handoff and the React document session afterward. Image intents delegate to the
separate Media Picker owner rather than creating another media authority.
The focused browser shortcut Adapter prepares without listening, then readiness
removes the Legacy normal-editor command listener before activating React's
single capture listener. It preserves the configured platform key matching,
editor-root scoping, native source handling, input exclusion, command ordering,
IME exclusion, and command delegation without creating another Save, Media, or
Clipboard authority.

The PHP editor shell renders separate React, legacy-main, and legacy-secondary
containers. The legacy main Toolbar remains active while the React entry
validates bootstrap data and mounts. Readiness performs one visibility and
presentation-owner handoff. Startup failure leaves the legacy main Toolbar
usable, and teardown unmounts React before legacy code may clear or reuse its
container.

The legacy command engine remains the startup fallback and continues to serve
the secondary Toolbar and the immersive Toolbar. Legacy Popover dismissal is a
separate retained listener so Font and Appearance startup fallback remains
usable after the normal command-shortcut handoff. If React shortcut activation
fails before any command can run, React detaches and the one Legacy command
listener is restored; if Legacy listener cleanup throws, ownership is marked
reload-required rather than claiming a successful handoff. The handoff
publishes explicit command and shortcut owners only after the React session is
ready, so the engines cannot mutate the normal document at the same time. Save,
Media, and WeChat shortcuts continue to delegate to their established owners.
This unit did not transfer draft storage, immersive writing, native submission,
Save, Publish, or WordPress authority, and it removed no shared legacy
implementation while those consumers remain.

## Normal Editor Document Session Ownership

The normal editor Markdown source and title session are the next React
migration unit. CodeMirror 6 owns the in-browser Markdown value, selection,
focus, undo history, and source scrolling after its readiness contract passes.
The native `#easymde-source` textarea stays in the WordPress form as a hidden,
synchronously updated submission bridge and as the pre-handoff command fallback
boundary. The native title input remains visible and
WordPress-owned; React observes it through a focused title session adapter
without creating another persisted title.

The PHP editor shell renders separate React and legacy source containers.
Startup keeps the textarea visible until the CodeMirror document session, title
session, native fields, and legacy consumers validate. Readiness switches one
explicit document owner, rebinds source scroll and paste/drop surfaces, and
hides the textarea. Startup failure keeps the legacy textarea usable. A failure
after handoff requires reload rather than switching two live document writers.
Native form submission flushes CodeMirror to the textarea before WordPress
serializes the open form.

PHP and WordPress continue to own Markdown and title persistence, rendering,
save, publish, permissions, nonces, revisions, autosave, and post locks. The
secondary Toolbar and immersive workspace remain legacy-owned, and this unit
does not migrate immersive writing.

## Normal Editor Preview Surface Ownership

The normal editor's Preview request scheduler, visible state, DOM output, and
scroll preservation are React browser-session responsibilities after
readiness. A focused Preview Port uses the existing WordPress REST contract,
while PHP remains authoritative for capabilities, Nonces, Markdown rendering,
sanitization, and response data. React applies the existing 180 millisecond
debounce, aborts superseded browser requests, and binds every completion to the
active request revision and Markdown signature so stale responses cannot
replace newer Preview output.

The PHP shell provides a dedicated empty React container beside the rendered
legacy article and declares legacy request and Surface ownership initially.
The legacy article remains visible while React validates the Bootstrap
contract, transport, Ports, Root, session, and committed article. Readiness
invalidates legacy work, copies the existing Theme classes and inline Font
style, preserves scroll, hides the legacy article, exposes the React article,
rebinds synchronized scrolling, and switches request and Surface ownership in
one handoff. Startup failure before that point keeps the legacy Preview usable
and emits only a stable privacy-safe diagnostic. Failure or teardown after
handoff requires a clean reload and never switches two live DOM writers.

The React article is the single normal-editor Safe Preview HTML sink. It keeps
existing sanitized HTML visible while a replacement request is loading,
renders mutually exclusive Loading, Empty, Error, Enhancing, and Ready states,
and restores the latest scroll snapshot. PHP Bootstrap remains the translation
owner for those messages. The existing local Preview feature loader remains a
focused Adapter for Mermaid, KaTeX, Highlight.js, TOC, and code-frame
enhancement; stale completion is rejected and failed enhancement preserves the
sanitized HTML without reporting export readiness.

Immersive Preview remains fully legacy-owned and keeps an independent request
revision, timer, abort, DOM, and enhancement lifecycle. No persistence, Save,
Publish, public rendering, or immersive-writing authority moves to React.

## Normal Editor Synchronized Scroll Ownership

The normal editor's bidirectional Source/Preview scroll coordination is a
focused TypeScript migration unit. A browser Adapter owns the two scroll
listeners, ratio mapping, 30 millisecond re-entry lock, pending unlock timer,
and idempotent cleanup after the first validated binding activates. It follows
the active normal Source and Preview surfaces, so CodeMirror and React Preview
replacement rebind through the same owner without creating another document or
Preview authority.

Bootstrap validates the production entry without registering listeners while
the Legacy normal-editor binding remains available. The first successful
binding commits React ownership. Preparation or activation failure before that
point emits only a stable privacy-safe code and keeps the Legacy binding usable.
Failure after handoff marks synchronized scrolling reload-required and never
installs a Legacy listener in the same session. Listener activation rolls back
partial registration, and cleanup removes both listeners and the pending timer.

This unit does not migrate Focus Mode view modes, its sync-scroll toggle,
divider, layout preferences, resizing, or workspace scroll behavior. Those
surfaces remain owned by `assets/js/admin/immersive-workspace.js`. The retained
Legacy normal-editor binding also remains as production-entry startup fallback
until the final consumer and removal gates are satisfied.

## Normal Editor Font Controls Ownership

The normal editor's Font button, Popover, and Custom, Windows, Apple, and Serif
selects are a focused React migration unit. React owns their presentation,
interaction, and browser-session selection after a validated readiness
handoff. PHP `ThemeStateRepository` continues to own the option descriptors,
theme defaults, validation, and persisted state. PHP
`AdminAssets::get_strings()` remains the translation owner, so React consumes
already translated Bootstrap strings and does not create a second catalog.

The focused WordPress Font Port applies the current Preview font class and CSS
variable and synchronizes the existing four hidden fields. Those fields remain
the native WordPress submission bridge; updating them is not proof of a Save.
Article Theme defaults and explicit changes made by the retained immersive Font
UI enter the active React Font session through its replacement method. Returning
to the normal editor therefore cannot expose or reapply stale Font state, and
the retained controls do not become a second normal-editor Font-state owner.

The legacy Font menu remains active and visible until the React contract,
container, Preview surface, native fields, Port, and session validate.
Readiness disables and hides the legacy control before exposing React. Startup
failure retains the legacy control. Failure after handoff marks the Font owner
reload-required and never re-enables a competing writer. Every immersive Font
surface remains legacy-owned.

## Normal Editor Appearance Controls Ownership

The normal editor's Appearance button and Dialog, Article Theme and Code Theme
selectors, Custom CSS library selection, and explicit Custom CSS editor/save
session are one focused React migration unit. React owns their presentation,
interaction, and browser-session state after a validated readiness handoff.
PHP Article and Code Theme registries, `ThemeStateRepository`,
`CustomCssPolicy`, REST permissions and Nonces, the current-user Custom CSS
library, native form serialization, and persisted post state remain
authoritative. PHP `AdminAssets::get_strings()` remains the translation owner,
so React consumes already translated Bootstrap strings and does not create a
second catalog.

The focused Appearance Port applies the existing Preview theme classes and
server-scoped Custom CSS, and synchronizes the existing hidden Article Theme,
Code Theme, Custom CSS ID, and Custom CSS snapshot fields. Those fields remain
the native WordPress submission bridge; changing them is not proof of a Save.
Custom CSS writes are single-flight, are never retried automatically, and
replace the React snapshot only after the complete server result validates.
A detached post Custom CSS snapshot remains representable even when the
corresponding current-user library item is absent.

The legacy normal-editor Appearance control remains active until the React
contract, container, required native fields, Preview surface, Port, and session
validate. The handoff preserves each legacy control's original disabled state,
then disables and hides the legacy writer before exposing React. Startup or
snapshot-reconciliation failure before handoff restores that exact state and
keeps Legacy active. Failure after handoff marks the owner reload-required and
never re-enables a competing writer. Explicit changes made by the retained
immersive Appearance UI replace the active React snapshot, but every immersive
Appearance surface remains Legacy-owned. The legacy implementation and hidden
rollback DOM are retained until the final consumer, failure, browser, and
release removal gates are satisfied.

## Normal Editor Media Picker Ownership

The normal editor's Media Library opening, selected-attachment validation,
Markdown image insertion, and Selection, Scroll, and Focus restoration are a
focused React-application migration unit. The TypeScript Feature receives the
active normal document owner through a narrow Port and delegates the native
modal and attachment selection to a WordPress `wp.media` Adapter. WordPress
continues to own capabilities, attachments, the Media Library, and modal
behavior; this unit creates no upload or persistence authority.

Activation validates the production bridge and translated Bootstrap strings
before marking the normal Media-picker owner as React. If the production entry
is unavailable or invalid, the existing lazy Legacy wrapper remains the normal
startup fallback. After handoff, one Media frame operation is allowed at a
time. Selection applies only when the captured Markdown snapshot is still
current; cancellation, an invalid attachment, a stale result, or a frame
failure never mutates Markdown and restores Focus. If `wp.media` is genuinely
unavailable, the established Markdown image placeholder remains the explicit
fallback rather than a reported native-media success.

The retained `assets/js/admin/media-picker.js` wrapper remains the active owner
for the intentionally excluded immersive workspace. It is not removed by this
unit, and immersive Media behavior is not transferred to React. Final Legacy
removal therefore requires a separate consumer inventory proving that both the
normal startup fallback and every immersive consumer have an approved
replacement or retention decision.

## Normal Editor Image Paste/Drop Ownership

The normal editor's pasted and dropped image recognition, upload coordination,
progress and failure status, Markdown insertion, and Selection, Scroll, Focus,
and teardown behavior are a focused TypeScript migration unit. The session
receives the active normal document owner through a narrow Port and delegates
the protected request to a WordPress Adapter. PHP and WordPress continue to own
capability and nonce checks, file validation, Media Library persistence,
attachment identity, and the authoritative upload response.

Activation validates the production bridge, WordPress upload runtime, complete
PHP-translated Bootstrap strings, document Port, event target, and cleanup
contract before marking the normal image-upload owner as React. Only after that
handoff does the coordinator detach the normal Legacy lazy listener. If any
preflight fails, the existing lazy Legacy owner remains usable. Teardown removes
the React listeners before restoring the normal Legacy binding.

Uploads are parallel and isolated by their captured operation snapshot. An
oversized or failed upload never mutates Markdown. A successful upload rebases
its captured selection against current Markdown before inserting, preserves the
active document's Scroll and Focus, and enters the existing Undo history.
Completion after teardown is diagnosed with a stable privacy-safe code and
cannot write into a later document session. Browser cancellation does not claim
that an already-started WordPress upload was cancelled.

The retained `assets/js/admin/image-paste.js` implementation remains the active
owner for the intentionally excluded immersive workspace and the normal-editor
startup fallback. It is not removed by this unit. Final Legacy removal requires
a separate consumer inventory proving that every immersive and fallback
consumer has an approved replacement or retention decision.

## Normal Editor Local Draft Ownership

The normal editor's Local Draft recovery reads, bounded writes, 500 millisecond
latest-write scheduling, restore/discard actions, and cross-tab conflict state
are a focused TypeScript migration unit. Browser `localStorage` remains the
recovery authority; a Local Draft is not a WordPress Save and never contains a
Nonce, credential, title, Preview HTML, or persisted WordPress result. PHP
Bootstrap supplies the Site, User, Post, Schema, 1 MiB limit, WordPress user
locale, Site timezone, and translated status messages.

The TypeScript storage Adapter writes the versioned
`easymde:draft:v1:<site>:<user>:<post-or-new>` payload and validates its shape,
UTF-8 size, fingerprint, timestamp, and schema on every read. A successful new
payload is authoritative even when an optional fingerprint sidecar or Legacy
key cleanup fails; those partial failures emit stable privacy-safe diagnostics
without claiming the recovery payload was lost. The old key is removed only
after the new payload and sidecar succeed. When both keys exist after a
pre-handoff Legacy fallback write or partial cleanup, both readers select the
newest valid payload by `updatedAt` rather than allowing a stale versioned key
to hide newer recovery content. The retained Legacy reader can read and discard
v1 payloads so a future pre-handoff startup failure does not strand recovery
data.

Preparation performs only a read-only inspection while Legacy remains active.
Activation subscribes to browser Storage, cancels the Legacy timer, and commits
one React-owned scheduler. A corrupt or unavailable read blocks writes instead
of overwriting uncertain recovery data. A different Draft arriving from
another tab cancels pending work and remains available until explicit Restore
or Discard. Disable and teardown cancel timers and listeners without deleting
recovery data; after handoff, teardown requires a clean reload and never
reactivates the Legacy writer in the same page.

The Local Draft notice and status elements remain in the established normal
editor chrome and use PHP Gettext strings. The intentionally excluded immersive
workspace continues to call the stable Local Draft compatibility surface and
passes its current Markdown into the React-owned latest-write scheduler; React
remains the only active Storage writer after handoff, while Focus Mode retains
its document and interaction ownership. Final removal of `assets/js/admin/draft-storage.js`
therefore requires a separate consumer inventory and explicit Focus Mode
decision.

## Normal Editor WeChat Export Ownership

The normal editor's stable-Preview export operation is a focused TypeScript
migration unit. The existing secondary Toolbar button and PHP Gettext strings
remain the presentation and copy authority; the operation resolves the current
active Preview Surface at invocation time so a later React Preview handoff
cannot leave it bound to a hidden Legacy node.

Preparation validates only the Feature flag and translated messages while the
Legacy exporter remains active. Activation creates one single-flight Clipboard
session and commits the normal-editor command handoff. The session rejects an
Empty, Loading, failed, refreshing, or enhancement-pending Preview before any
Clipboard mutation. It copies both styled HTML and plain text, reports success
only after the browser Clipboard API or synchronous compatibility copy returns
success, and returns an explicit failure when neither path succeeds. Completion
after teardown cannot update visible status and emits only a privacy-safe code.

`assets/js/admin/wechat-exporter.js` remains the pre-handoff normal-editor
fallback and the intentionally retained immersive-workspace Clipboard owner.
After the normal-editor handoff, the secondary command delegates only to the
TypeScript session; teardown is reload-required and never reactivates the
Legacy normal-editor mutation path. Focus Mode keeps its existing action,
feedback timer, Preview dependency, and Clipboard behavior. Removing the Legacy
exporter therefore requires a separate consumer inventory and an explicit
Focus Mode decision.

## Editor Enablement

EasyMDE opens new and existing content for post types explicitly supported by `easymde_supported_post_types` in EasyMDE through normal WordPress editing when the current user can edit or create that content. The default supported post types are `post` and `page`.

EasyMDE metadata describes document state and compatibility output; it no longer decides editor admission. Existing EasyMDE posts remain compatible:

- `_easymde_enabled = 1` marks a post as having EasyMDE document state.
- If `_easymde_enabled` is missing but `_easymde_markdown` exists, the post is treated as a legacy EasyMDE document-state post.
- The legacy check uses `metadata_exists()` so an empty Markdown value still counts.

Opening an ordinary existing supported post without EasyMDE metadata imports
current `post_content` into Markdown in memory for the editor. It does not write
metadata, rewrite `post_content`, or create revisions. Legacy posts and ordinary
supported posts are migrated lazily. On the next valid EasyMDE save, the plugin
writes `_easymde_enabled = 1`, stores Markdown state, and writes rendered
compatibility HTML. It does not scan or update every post during upgrade.

## Markdown And HTML

`_easymde_markdown` remains the authoritative source. `post_content` remains the
rendered HTML compatibility output.

Valid EasyMDE saves also write `_easymde_render_signature`, an internal
consistency marker tying the current Markdown, article theme, and stored
compatibility HTML together. The marker lets the editor reuse stored HTML for a
fast initial preview only when it still matches the authoritative Markdown
state.

The fallback Markdown renderer has been removed. `league/commonmark` is required
for rendering. A development checkout without Composer dependencies shows an
admin notice and avoids writing newly rendered HTML.

Production release packages must include Composer dependencies in `vendor/`.

## Revision Behavior

The following meta keys are copied to new revisions and restored from revisions:

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

When a revision containing EasyMDE meta is restored, the restored Markdown and
theme state are copied back to the post. EasyMDE regenerates `post_content` and
stores a new render signature only when Markdown rendering succeeds. If the
renderer is unavailable or rendering fails, the restore path uses the
revision's stored `post_content` without generating a new signature. Any render
signature stored on that revision is restored with the other revisioned
metadata and remains subject to normal consistency validation.

The restore path updates `post_content` directly and clears the post cache to
avoid recursive save hooks or extra revision loops.

When a revision predates EasyMDE document state and contains none of the
revisioned EasyMDE metadata, restoring it removes the current revisioned
EasyMDE metadata and restores that revision's historical `post_content`. The
post then no longer has EasyMDE document state.

## Fixed Mac Code Frame

The Mac-style source-code frame is now a fixed rendering default rather than saved appearance state. New post saves, user defaults, preview requests, and revisions no longer create or update Mac-frame state.

Existing `_easymde_code_mac_style` post/revision meta and `codeMacStyle` entries in user defaults are retained byte-for-byte. EasyMDE does not migrate, delete, normalize, copy, restore, or consult those historical values. Saving other supported appearance defaults preserves unknown historical user-default fields while updating only the active fields.

## Custom CSS

Existing custom CSS library data remains readable from the current user's
`easymde_custom_css_library` user meta.

New, updated, and deleted full custom CSS requires `unfiltered_html`. CSS is parsed with
`sabberworm/php-css-parser` before storage or scoping. Unsafe features such as
`@import`, `@charset`, `@font-face`, `url(...)`, `expression(...)`,
`behavior`, `-moz-binding`, and `javascript:` are rejected.

If legacy CSS cannot be parsed safely, the stored value is retained but scoped
frontend output is omitted.

## Theme Assets

Article themes moved from the previous all-in-one stylesheet into
`assets/themes/article/`. Highlight.js vendor styles moved to
`assets/vendor/highlight/styles/`. The owned `wechat-inspired` code theme moved
to `assets/themes/code/wechat-inspired.css`.

Old active theme meta IDs are unchanged, so existing posts continue to resolve their selected article theme, code theme, and custom CSS snapshot. Historical Mac-frame values remain stored but no longer affect rendering.
