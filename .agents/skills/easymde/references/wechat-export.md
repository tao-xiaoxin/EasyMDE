# WeChat Export

## Contents

- [Source and session owner](#source-and-session-owner)
- [Activation and preparation](#activation-and-preparation)
- [Portable serialization](#portable-serialization)
- [Layout and special content](#layout-and-special-content)
- [Failure and evidence](#failure-and-evidence)

## Source and session owner

WeChat export is a user-initiated compatibility output, never a persistence,
publication, or second rendering authority. `createWechatExportSession` owns
the ordinary and immersive surfaces; `createBrowserWechatClipboard` owns one
clone-and-serialize pipeline. The session passes the current stable,
sanitized, locally enhanced Preview sink. Never copy Markdown, CodeMirror DOM,
editor chrome, or a separately rendered document.

The modern Clipboard API and legacy `document.execCommand('copy')` path consume
the same normalized HTML. The modern path derives `text/plain` from the
connected normalized export surface captured for the same preparation, removes
exporter whitespace markers, and normalizes non-breaking spaces. The legacy
path selects the same HTML and lets the destination derive visible plain text.
The plain-text measurement host uses the rendered Preview width, including the
last non-zero visible width while immersive source mode hides Preview.

Before touching Clipboard, the session rejects disabled, inactive, empty,
loading, and error Preview states with a distinct unavailable result. It
coalesces concurrent copy requests, maps Adapter rejection to explicit failure,
reports unsupported Clipboard separately, and suppresses late status after
teardown.

## Activation and preparation

Stable Preview notifications schedule one debounced background preparation for
the active sink after Preview settles. The environment observes image/video
load, error, metadata, resize, FontFaceSet completion/failure,
ResizeObserver geometry, and inserted/removed descendants; removed nodes are
unobserved immediately. Sink changes and Root teardown remove all observers
and listeners. The active surface may be the immersive visual Preview; a
hidden ordinary surface must not replace it.

EditorRoot starts at most one full serialization per sink, retains only the
latest request while it runs, and inserts a quiet turn before replacement.
Background style and geometry walks yield to browser tasks. Appearance or
Custom CSS changes that tear down visual editing wait for the refreshed active
Preview before preparing it.

Approved same-origin theme-image requests use the bounded cache and payload
limits defined by the live serializer. Only `/assets/images/` GIF, JPEG, PNG,
or WebP sources are eligible. Each request has an abortable time bound covering
fetch, response-body reads, and Data URL conversion. A timeout or conversion
failure evicts the cache entry and fails preparation so a later copy may retry.
The Adapter forwards the serializer's RequestInit signal unchanged. Read
`frontend/src/integrations/browser/wechat/create-browser-wechat-clipboard.ts`
and `docs/ARCHITECTURE.md` for the current cache, payload, and timeout limits;
do not copy their numeric constants into this reference.

When theme-image preparation is pending, the modern path creates one
`ClipboardItem` with deferred Blob payloads and starts `navigator.clipboard.write`
in the originating click task. The path remains asynchronous when no image is
pending; background work must not synchronously serialize a full Preview. If
ClipboardItem construction or the write invocation throws synchronously and no
prepared payload exists, one synchronous serialization attempt may use the
same-click legacy fallback. A pending preparation or a modern write rejection
after an await never crosses into legacy. A fast write followed by a deferred
payload failure is still failure.

The legacy path calls `execCommand` synchronously in the originating click task
only with a ready payload. A click before preparation completes fails. If a
transient preparation failed and no prepared entry exists, that click starts
one background retry but still fails; a later click may use it after success.
Keep a last successful payload only while source markup is unchanged. A
successful replacement supersedes it; a failed replacement restores the newest
same-source success, and monotonic generations prevent an older completion
from downgrading it. Viewport-coordinate-only scroll changes may reuse a
payload; dimensions and computed wrapping styles invalidate it. Full sink
markup, root `class`/`style`, viewport, computed export styles, pseudo-element
styles, and geometry participate in freshness.

## Portable serialization

Clone only the received Preview surface. Remove scripts, styles, controls,
CSS classes, and editor/source transient attributes. Keep valid fragment IDs
and SVG-internal IDs, safe image `src`/`srcset`, safe link URLs, and approved
computed typography/layout. Remove unsafe URLs. Non-allowlisted CSS background
URLs become `none` layer slots while safe colors, gradients, and layer order
remain.

Materialize only bounded same-origin theme backgrounds as data images. Preserve
repeating backgrounds as CSS instead of flattening them. For a non-repeating
multi-layer background retain gradients and materialize every safe image in
source order with its matching size, position, and isolated stacking level.
Expand and compact `background-repeat`, `background-position`, and
`background-size` with CSS repeated-final-layer semantics after removed layers.
Preserve omitted/`auto` intrinsic sizing, `cover`/`contain` object-fit
equivalence, numeric size tokens, four-value edge offsets, and `max-width:none`
for fixed decoration images. Generated image dimensions must not be overwritten
by generic responsive media rules.

Materialized overlays sit at an isolated negative stacking level behind copied
text. Normalize percentage positions before centered-axis composition; follow
CSS missing-axis defaults for one-token positions and axis order for
keyword/offset pairs. Do not reactivate fixed/sticky positioning; neutralize
offsets inert under static positioning when creating a relative containing
block. Preserve safe non-root decoration dimensions, positioning, flex sizing,
float, overflow, box sizing, borders, and quoted-literal pseudo-element
decoration. Omit `attr()` and counter pseudo content. Exporter-owned
`aria-hidden` and `leaf` markers may remain.

Keep only the KaTeX `.katex-mathml` fallback tree removed; preserve its visual
tree and SVG geometry. Preserve hidden SVG `defs` required by visible
clip-path, mask, gradient, or filter references; discard unrelated hidden
nodes. Keep non-math SVG and media responsive without changing an inline
element's display or margins. Normalize article/div roots to portable sections,
wrap text leaves, and encode code-line breaks while keeping each source line
non-wrapping.

## Layout and special content

Mermaid `foreignObject` labels are a scoped SVG compatibility boundary. Give
Mermaid roots and label containers visible overflow, use non-wrapping semantic
`nobr` structure with zero-width word-joiner markers, intrinsic `max-content`
sizing, and expand numeric label boxes around their original center by at least
32px or 1.5x. The markers are removed from modern plain text. Do not apply
these rules to ordinary SVG or KaTeX geometry.

Tables and long display formulas own horizontal overflow; no exporter wrapper
may impose whole-article height or vertical scrolling. Tables keep intrinsic
`max-content` sizing inside a real block scroll owner, so short tables remain
centered and wide rows scroll. Geometry-derived full-width classification is
cached per source table while immersive source mode hides Preview and replaced
on a later visible refresh. Preserve theme table shims (`display:contents`,
`container-type`, and `100cqi` pseudo-element geometry). Task-list checkboxes
retain checked state as disabled attribute-minimized controls; arbitrary form
controls are removed.

## Failure and evidence

Copy success is reported only from the real browser result. On every legacy-path
exit restore temporary DOM, Selection, Focus, and Scroll. Do not mutate article
state. Adapter or preparation rejection remains explicit failure; no partial
payload is published. Tests must cover modern/legacy HTML parity, activation
timing, deferred failure, unsafe URL/style removal, theme-image timeout and
retry, Mermaid non-ASCII labels, KaTeX/SVG preservation, table/formula overflow,
hidden-surface behavior, concurrent requests, active-surface changes, and
teardown. Use semantic readiness, not fixed sleeps, and record unverified
browsers or destination behavior honestly.
