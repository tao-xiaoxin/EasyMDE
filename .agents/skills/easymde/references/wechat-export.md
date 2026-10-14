# WeChat Export

## Contents

- [Source and session owner](#source-and-session-owner)
- [Activation and preparation](#activation-and-preparation)
- [Optional PNG conversion](#optional-png-conversion)
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
the same normalized HTML. The modern path derives `text/plain` from a connected
plain-text clone of that same serialized export surface, removes
exporter whitespace markers, and normalizes non-breaking spaces. The legacy
path selects the same HTML and lets the destination derive visible plain text.
After the HTML string is captured, browser layout derives plain text from
the exclusive detached serialization tree. Non-layout DOM environments may
retain the existing line-aware source-text fallback when their connected tree
flattens block boundaries. The temporary layout host is removed in `finally`
on every path.
The plain-text measurement host uses the rendered Preview width, including the
last non-zero visible width while immersive source mode hides Preview.
The optional `rememberPreviewWidth` port hook records only one positive finite
root width; `EditorRoot` calls it when Preview is ready and immediately before
source mode hides that Preview. This width is measurement input only, not a
content, payload, or rectangle cache.

PHP remains authoritative for Preview source provenance and its connected
readonly overlap projection. Clipboard consumes the accepted Safe Preview and
never changes the edit map or Source Editor.

Before touching Clipboard, the session rejects disabled, inactive, empty,
loading, and error Preview states with a distinct unavailable result. It
coalesces concurrent copy requests, maps Adapter rejection to explicit failure,
reports unsupported Clipboard separately, and suppresses late status after
teardown. There is at most one active copy operation per session. Disposal or
session replacement signals cancellation to the adapter and invalidates its
sequence, so a late result cannot publish status or success for the replaced
session.
While Copy is pending, both ordinary and immersive controls remain focusable
and expose `aria-busy="true"` and `aria-disabled="true"` instead of native
`disabled`. The shared pending reference rejects duplicate click and keyboard
activation. The static WeChat glyph retains the control's geometry while Copy
is pending; only an unavailable capability uses native `disabled`.

An article-theme, code-theme, or Custom CSS change owns cancellation of an
active Copy. The session returns `status: cancelled` with
`wechat-copy-cancelled`, emits an info diagnostic for the intentional
cancellation, and emits neither a success nor a failure status. A real Adapter
failure or residual upload remains an explicit diagnostic and side-effect
result; cancellation does not erase it. The appearance change refreshes
Preview only and never starts Copy automatically, so a new theme requires a
new explicit Copy. While the new style is loading, both Copy controls remain
focusable and expose `aria-disabled="true"` without `aria-busy`.

## Activation and preparation

Stable Preview notifications schedule one debounced background preparation for
the active sink after Preview settles. The environment observes image/video
load, error, metadata, resize, FontFaceSet completion/failure,
ResizeObserver geometry, and inserted/removed descendants; removed nodes are
unobserved immediately. Sink changes and Root teardown remove all observers
and listeners. The active surface may be the immersive visual Preview; a
hidden ordinary surface must not replace it.

EditorRoot's background demands carry a caller-owned `AbortSignal` for their
sink.
EditorRoot cancels that demand when visual unlock begins, Preview status leaves
`ready`, the ordinary or immersive sink is disposed or replaced, the Root tears
down, or the WeChat Port/export owner changes. The Adapter keeps per-sink
waiters and one active background job; cancellation removes the caller and
stops pending or active serialization only when no waiters remain. The job
checks cancellation before final markup, plain-text derivation, and publishing
prepared payload/cache state. Background-demand cancellation does not abort
shared theme-image fetches or their reusable cache work, and explicit Copy has
an independent operation signal and lifecycle.

EditorRoot starts at most one full serialization per sink, retains only the
latest request while it runs, and inserts a quiet turn before replacement.
Background style and geometry walks yield to browser tasks. Appearance or
Custom CSS changes that tear down visual editing wait for the refreshed active
Preview before preparing it.
Each serialization work slice uses the owner-defined measured budget after the
browser task resumes; time spent waiting for that task is excluded and does not
consume the slice.
Async serialization also checks the existing budget after HTML capture and
after connected plain-text measurement. Only an exhausted budget yields a
browser task; check cancellation and PNG currentness before and after each
yield. The real layout-derived text, serialized bytes, final freshness checks,
and cleanup remain unchanged. Synchronous legacy serialization never awaits
these checkpoints.

Approved same-origin theme-image requests use the bounded cache and payload
limits defined by the live serializer. Only `/assets/images/` GIF, JPEG, PNG,
or WebP sources are eligible. Each request has an abortable time bound covering
fetch, response-body reads, and Data URL conversion. A timeout or conversion
failure evicts the cache entry and fails preparation so a later copy may retry.
Theme-image fetches retain their own timeout/abort lifecycle; a background
demand signal does not abort an in-flight shared asset fetch. Read
`frontend/src/integrations/browser/wechat/wechat-background-images.ts`
and `docs/ARCHITECTURE.md` for the current cache, payload, and timeout limits;
do not copy their numeric constants into this reference.

When theme-image preparation is pending, the modern path creates one
`ClipboardItem` with deferred Blob payloads and starts `navigator.clipboard.write`
in the originating click task. The successful modern setup invokes `write()`
before its first browser-task yield and before any computed-style, pseudo-style,
or geometry freshness walk. The path remains asynchronous when no image is
pending; background work must not synchronously serialize a full Preview. If
ClipboardItem construction or the write invocation throws synchronously and no
prepared payload exists, one synchronous serialization attempt may use the
same-click legacy fallback. A pending preparation or a modern write rejection
after an await never crosses into legacy. A fast write followed by a deferred
payload failure is still failure.
For portable modern Copy, the non-windowed source-freshness guard is captured
after the native `write()` starts and before the first browser-task yield. A
pending entry is awaited only after its stored `sourceMarkup` matches the
current full key; an obsolete entry is ignored locally and the existing fresh
preparation path is used. The windowed baseline is captured only after
`resolvePreview` completes legitimate materialization. An older same-source
background promise may trigger one fresh preparation only for the two narrow
internal recoverable errors: `wechat-copy-stale` and an `AbortError` whose
message is `wechat-background-preparation-cancelled`. Before recovery, the
activation-source, session, and signal guards must remain current; a
current/user abort or stale owner propagates cancellation and does not retry.
All other failures propagate unless a completed same-source fallback was
recovered. The stale/cancelled path performs one fresh preparation, preserves
completed same-source fallback reuse, does not retry other failures, and
never starts a second native write. All terminal
paths clean up freshness state; this transaction-local guard adds no global
activation layout lock and changes no limits.

For the ordinary modern path, the deferred HTML and plain-text Blob
preparation has a 60-second bound. Once both Blobs and the serialized payload
are ready, the actual browser Clipboard commit has its separate 10-second
bound. A browser write rejection that arrives before payload readiness fails
immediately; a late payload, stale-source, abort, or teardown failure gates the
deferred Blob values and cannot turn an already-started write into success.

The legacy path calls `execCommand` synchronously in the originating click task
only with a ready payload. A hidden measurement lease that has not reached
readiness fails explicitly before `execCommand` and performs no synchronous
resource work; a ready synchronous path performs no additional image readiness
or loading work. If a transient preparation failed and no prepared entry exists,
that click starts one background retry but still fails; a later click may use it
after success.
Both paths keep a last successful payload only while source markup is unchanged.
A successful replacement supersedes it; a failed replacement restores the
newest same-source success, and monotonic generations prevent an older
completion from downgrading it. Viewport-coordinate-only scroll changes may
reuse a payload; dimensions and computed wrapping styles invalidate it. Full
sink markup, root `class`/`style`, viewport, computed export styles,
pseudo-element styles, and geometry participate in freshness. Only `aria-busy`,
`data-easymde-preview-accepted`, and `data-easymde-preview-refreshing` on
the sink root are refresh bookkeeping excluded from the source key; the same
attributes on descendants and every other root attribute still invalidate it.
The layout-signature read may be narrowed to export-relevant per-node property
sets: context `direction` remains covered for every node, root `position` and
root pseudo `box-sizing` remain covered, and the relevant style/layout sets
remain covered for each node class. Any such optimization must still visit all
nodes, retain source markup, element dimensions, viewport signature,
cancellation, and the initial/current/final comparisons.
For each pseudo-element, a non-emitted value (`pseudoContent(rawContent) ===
null`, including `none`, `normal`, and unsupported values) contributes only its
raw `content` sentinel to freshness and skips unused pseudo-style reads,
serialization, and asset fetch. Quoted empty and text pseudos retain full styles
and existing limits; ordinary-node, source, and geometry handling is unchanged.
The PNG conversion path uses that same source key across asynchronous checks.
Each transaction-local freshness guard installs its `MutationObserver` before
the initial snapshot and drains `takeRecords()` at the initial, current, and
final checkpoints. Each checkpoint also scans recognized task inputs' current
`checked` properties, because a property change need not emit a DOM mutation.
An otherwise clean guard reuses its source key only when that state matches;
it avoids full markup, style and geometry recomputation but is not an O(1)
decision. A dirty guard or changed task state recomputes the current complete canonical source key and compares it with the
immutable initial key, so a mutation that returns to the same value remains
reusable while an observed real source change becomes permanently stale. Final
checks still compare the complete source and layout keys and keep
the existing Preview-owner and layout guards. Abort, timeout, stale, and
teardown paths gate the deferred result; `finally` disconnects the observer,
including late cleanup after an earlier failure.

## Optional PNG conversion

`images.wechatPngExportEnabled` is a persisted strict boolean that defaults to
`false`; a missing stored value reads as `false` without writing. Settings
transfer schema 10 requires the field, while schemas 1 through 9 import it as
`false`. Editor bootstrap exposes the effective value only as
`wechatExport.pngConversionEnabled`.

When disabled, Copy follows the existing portable-HTML path unchanged. When
enabled, conversion runs only during an explicit ordinary or immersive Copy
from the current stable Preview. Background preparation performs no
rasterization or upload. With PNG conversion enabled, EditorRoot skips unused
portable background preparation, its resize/layout subscriptions, and its
queued timer; explicit Copy still obtains a fresh payload for the current
source. The only candidates are the outermost rendered
`.easymde-mermaid` root containing SVG and outermost rendered
`.easymde-math`, `.easymde-math-block`, or `.easymde-math-inline` root
containing KaTeX. Nested candidate descendants are part of their outer root and
are not converted or uploaded separately. Ordinary tables, existing `<img>`,
ordinary SVG, code, other media, and unknown content remain on the existing
portable-HTML path.
Rasterization must share the existing 8ms serialization task budget through
its optional typed Port callback, not create another scheduler. Checkpoints
follow complete geometry-host cleanup, SVG serialization, and image-URI
generation. Abort checks apply even when no yield is due; an actual yield
retains the Clipboard owner's currentness checks before and after waiting.
Rejection stops subsequent decode, encoding, and upload without changing the
10-second rasterization or 60-second transaction limits.
PNG encoding consumes only the existing, fully drawn capture Canvas through
the injected encoding Port. It does not render Markdown, SVG, fonts, or article
styles in the worker. A detached 1x1 OffscreenCanvas probe must confirm its
converter and 2D context before selecting the worker capability path; absent
Worker, ImageBitmap, or Offscreen capability selects the existing native
Canvas encoder before the operation starts. Actual worker failures never retry
or switch encoders. Each serial encoding job transfers one ImageBitmap to one
temporary local module worker and accepts only the matching strict protocol
operation ID with a nonempty PNG Blob. Success, error, messageerror, invalid
reply, postMessage failure, abort, and late bitmap creation all release owned
bitmaps and terminate the worker. The existing 10-second rasterization timeout
rejects conversion and aborts the encoding signal; the 60-second transaction
clock is not restarted. Geometry, DPR, PNG limits, digest naming, candidate
order, and the three-upload cap remain with their existing owners.
For a PNG candidate, the outer clone still receives its computed root metadata,
class/transient-attribute sanitization, and visual-root registration before the
conversion short-circuit. Because the native PNG replaces that whole root,
conversion skips descendant, pseudo-element, and theme-background portable
serialization; native capture still reads the current source tree. When the
resolved Safe Preview is hidden or source mode is active, explicit Copy obtains
one ephemeral measurement lease for the current enhanced Preview. The same
lease supplies portable HTML/plain-text serialization and PNG visual-root
capture, including original parent typography, rather than a separate
native-visual-only path.
The original Safe Preview remains the source, prepared-cache key, and freshness
owner. The Root keeps `preview`/`split` presentation separate from source mode;
ordinary entry is `split`, and source-mode entry records the last visible width.
If pending portable background preparation started against a visible live
Preview that is now hidden, foreground Copy cancels that exact old producer
and acquires the current measurement lease without waiting for obsolete shared
resource or transition promises. The old signal still prevents late geometry
reads and cache publication. Pending preparation that already owns a hidden
measurement lease remains reusable; Copy must not create a second lease.
Geometry failures are not cancellation or retry substitutes.
The lease retains the Preview presentation marker and class context, paper
geometry, canvas media-query presentation, and full Preview wrapping. Temporary
geometry and raw semantic trees exclude runtime sink, acceptance, refresh,
error, and editor-owner identity markers; only the original Preview owns those
identities. Attribute refresh must not restore them. The measurement lease is not
a cached measurement DOM; lease transfer into the active preparation and
cleanup cover success, failure, abort, stale, timeout, and teardown. The
cloned images must settle through load/decode or explicit failure before any
freshness fingerprint, including a warm-cache reuse check, or payload commit.
Lazy clones are temporarily made eager and their loading attributes are
restored. Readiness stays within the existing per-resource and transaction
bounds without resetting the transaction clock; abort cancels immediately,
late events cannot publish or cache work, and cleanup is terminal. The lease
retains the original paper geometry for hidden-surface measurement; it does not
strip editor-paper CSS from that geometry tree or mutate the live Preview or
article content.
Hidden readiness attaches each clone image's load/error/decode listeners before
the temporary host is attached. After attachment it forces one initial layout
on the measurement root, then reads the current owner's `document.fonts.ready`;
initial, current, and final freshness fingerprints and payload work wait for
that font readiness and every clone image's load/decode completion. An absent or
already-loaded FontFaceSet with no clone images and no active eligible finite
CSS effects preserves the synchronous legacy-ready path. The lease does not install a document-wide `loadingerror`
listener; managed font fetch/parse failures remain the visual rasterizer's
explicit failure boundary. Abort, cleanup, and late font resolution are
terminal. The existing 10-second resource deadline, 60-second transaction,
8ms serialization yield budget, and write-first activation remain unchanged.
Initial readiness also waits for finite native CSS transitions and animations
owned by the accepted Preview and its attached measurement tree before capturing
styles, geometry, or cache signatures. JavaScript and infinite effects are
excluded. Running, pending, and paused finite effects share the existing resource
deadline with fonts and images; success clears that deadline. A CSS effect API failure
or rejected `finished` promise is terminal for that lease unless its owned
operation signal aborts. Synchronous legacy and cache gates require successful
initial readiness and cannot bypass a latched failure. Final gates reject new
or changed finite CSS effects as stale without waiting again or rebasing the source.
This never pauses, cancels, or changes source animations and adds no post-ready
timeout to a valid upload transaction.
Portable root styles use the current root-export property mask, including root
background, layout, and pseudo-element styles. Visible serialization reads the
marked temporary raw context clone, whose marker lasts only for the controlled
temporary-host lifetime. Hidden measurement briefly sets
`data-easymde-wechat-export-style-context` on the measurement clone while taking
the root snapshot and restores it in `finally`; the original Safe Preview root
is never marked. Neither temporary context is persisted on the live Preview or
payload, and root-projected styles participate in the prepared freshness
signature.
Dimension semantics use a bounded raw clone-context batch separate from the
serialization tree. Visible layout geometry remains measured from the original
source; hidden/source layout reuses the measurement tree with raw source
semantics. The ordinary preservation path has a bounded seven-field raw tuple:
`box-sizing` plus `width`, `min-width`, `max-width`, `height`, `min-height`, and
`max-height`. It applies only to same-namespace normal-flow elements with
`display:block`, `position:static|relative`, `float:none`, a non-replaced
element, and raw `box-sizing:content-box`; every dimension must be a finite
non-negative `px` or `%` token or its property-specific `auto`/`none` keyword,
and at least one percentage must have positive padding-plus-border edges on
its axis. Root and pseudo-elements, replaced elements, descendants whose raw
formatting owner (including through `display:contents`) is flex/grid/table,
elements under `svg`, `math`, `pre`, `code`, or `table`, visual-rasterization
and KaTeX/Mermaid owners or descendants, and generated clones are excluded.
An eligible tuple preserves its six raw dimensions and `box-sizing`; only
`box-sizing` and `max-width` receive `!important` in this dimension path so
they survive native rules. Ordinary content-box values outside this tuple
retain the existing serializer behavior: finite pixels project to border-box
with CSSOM padding and border widths, while percentage and `calc()` values
retain the CSSOM `calc(semantic + edge pixels)` projection path. SVG, math,
PNG, pseudo-element, and other special geometry stays atomic; ordinary images
retain semantic width growth and `height:auto`. Raw `box-sizing` and dimensions
participate in initial, current, final, and warm freshness signatures, so equal
used geometry does not hide a raw semantic change. Raw context and
serialization clones are separate and bounded, and all temporary display,
attributes, and clones are restored or removed in `finally`; the batch uses at
most two deep clones.
portable/default, background, legacy, table, and ordinary-SVG paths otherwise
remain unchanged.

PNG Copy requires the modern Clipboard path. Construct deferred HTML and plain
text payloads and call `navigator.clipboard.write()` in the originating click
task before beginning serial rasterization and upload. Legacy Clipboard and a
synchronous modern setup failure perform no PNG upload and fail explicitly;
an asynchronous write or deferred-payload failure never falls back to legacy.
Clipboard success requires every conversion, selected-owner upload, deferred
payload, and browser write to succeed.

The visual rasterizer waits for document font readiness before encoding. It
resolves managed font roots from the approved
`previewEnhancement.assetBaseUrl` and approved KaTeX stylesheet URL supplied by
bootstrap, rather than inferring roots from arbitrary CSS suffixes. It embeds
only matching managed same-origin `@font-face` sources as data fonts in the
raster SVG; remote or unrecognized font URLs are omitted. For each matching
face, the first approved source in existing CSS order is the only source
downloaded and natively validated, while all retained weight, style, stretch,
unicode-range, and other face descriptors remain attached to their separate
faces; failure of that selected source fails conversion explicitly without an
alternate-source retry or fallback substitution. A required managed
family with no source face, invalid or rejected bytes, or failed browser-font
validation fails explicitly. Only nonmanaged or system families may remain on
the browser's available fallback font. Font fetch, response-body, cache, and
aggregate embedding limits remain bounded and cancellation or font failure
rejects the visual conversion. A successful PNG filename includes the lowercase
SHA-256 digest of its final bytes, so identical output is stable and different
output cannot collide solely on the visual kind.

Discover candidates in stable source order and rasterize them serially, with at
most 32 candidates. After each raster result passes the per-file and aggregate
limits, enqueue its selected-owner upload with backpressure and at most three
in-flight PNG uploads. Keep completed uploads keyed by candidate order and
replace visual clones only after every selected-owner upload succeeds, in that
same order. Use the current device pixel ratio clamped to `1..2`; each source
edge is `1..4096` CSS pixels. The encoding host and worker accept output edges
up to 8192 pixels after DPR scaling, with the same 16,777,216-pixel per-PNG
ceiling; increasing an edge must not increase this pixel budget. The transaction
is at most 33,554,432 output pixels. Each PNG must be non-empty
verified `image/png`, no larger than the authoritative image-upload `maxBytes`;
all PNGs together are at most 33,554,432 bytes. Each rasterization has a 10,000
ms bound and the conversion transaction has a 60,000 ms bound. Any
cancellation, stale Preview, invalid dimension or MIME, limit exhaustion,
timeout, rasterization failure, selected-owner upload failure, or Clipboard
failure aborts remaining in-flight uploads and rejects the whole deferred
payload. The result remains explicit about uploads that may already remain.
Default PNG pixel dimensions round each captured CSS dimension upward after
multiplication by the clamped device pixel ratio. Default pasted display
dimensions preserve the captured geometry.

The explicit `responsive-viewport` Mermaid mode is a narrow exception. A
proven neutral, auto-height root with one direct, untransformed SVG may capture
that SVG rather than the editor row's transparent layout space. Require
effective percentage width, automatic height, a finite renderer cap already
reached, default meet behavior, and proven horizontal auto margins. Reject
outer-root paint, decoration, pseudo content, padding, borders, radius, extra
children, animations, effects and ambiguous layout from this regime. Reject
unsafe external SVG decoration, while preserving the SVG scene and all SVG
viewBox padding; never crop by painted pixels. Clear only the private capture
clone's external margins. This mode uses `ceil(svgWidth * DPR)` pixel width and
`round(pixelWidth * svgHeight / svgWidth)` pixel height; validate the actual
integer dimensions and all existing limits. Its retained-root IMG uses
percentage width, the source SVG cap, automatic height and the existing
centering semantics. Preserve the serialized outer-root layout declarations;
this mode does not add an intentional-scroll width-check exemption. Record
the capture choice, selected SVG identity, root-relative bounds, dimension
semantics and centering before asynchronous cloning; keep that initial state
immutable and revalidate it at final freshness. Native aspect and pixel evidence
at DPR1/2 are required; geometry thresholds do not change. Math, intrinsic,
decorated and compensated paths retain their established behavior.

Responsive Mermaid roots may scale a larger SVG viewport into the Preview.
Compensate that downscale only for a connected, paint-bearing, auto-height
Mermaid owner with no active animation or fixed physical/logical height. The
direct child SVG must fill the owner's content box, use default
`xMidYMid meet` aspect behavior, have no transform, padding, or border, and
differ from its intrinsic aspect ratio by no more than the browser's `1/64px`
layout quantum. Derive the uniform compensation from the smaller of the two
SVG-viewport-to-viewBox ratios; ambiguous geometry keeps its captured size. A
compensated PNG uses an auto-height, full-width local horizontal scroll owner.
Mermaid Gantt layout uses `useWidth:1200` with `useMaxWidth:true`, so narrow
Preview width cannot become the time-axis layout width. Rendered Gantt,
Sequence and Timeline roots use their single direct SVG's validated role and
final viewBox to retain intrinsic dimensions inside the responsive horizontal
scroll owner. Sequence and Timeline widths are renderer output, not fixed
plugin constants. The marker and SVG role must agree; sanitized capture clones
restore only that verified role. Other diagram roles retain their existing
responsive path.

Intrinsic capture validates the default `xMidYMid meet` CTM against the smaller
rect/viewBox axis ratio, with projected diagonal residual and independent
rect/viewBox differences bounded by the existing `1/64px` layout quantum.
Finite positive scale, shear, explicit/ancestor transform, positioning,
internal clipping and authored-height gates remain independent. Capture uses
the intrinsic viewBox plus validated padding and solid-border edges, preserving
finite non-overlapping rounded solid root paint once. The generated local-scroll
wrapper does not duplicate that decoration or include editor viewport space.
Invalid marked intrinsic geometry fails explicitly without a narrow fallback.

Math capture uses a separately styled clone of the same Safe Preview source.
The adapter copies all safe computed dimensions and normal defaults into that
clone and does not apply portable serializer markers, empty `U+2060` spans, or
portable CSS rewrites. KaTeX, table, and pstrut computed dimensions and normal
defaults remain in the native snapshot; computed `table-layout` remains part of
it, and there is no authored-dimension preference rule. The clone is measured
before capture normalization. Unconstrained inline/block captures neutralize
root margin and positioning, remove max-size constraints, and use max-content
sizing with visible overflow to union source scroll dimensions, descendant
layout bounds, and the requested root size. Constrained inline roots preserve
their source viewport dimensions and max constraints for `hidden`, `clip`, and
`visible`; each axis is independent, so `autoX`/`hiddenY` expands X and clips Y,
while `hiddenX`/`autoY` does the inverse. This preserves the complete
display-formula extent, including a wide scrollable KaTeX formula. The measured
dimensions are rechecked against the existing
`1..4096` source edge and PNG pixel bounds, with fractional paint bounds
quantized once by flooring minima and ceiling maxima on the paint grid.

For every inline math root (`inline`, `inline-block`, or `inline-flex`), the
raster port receives the original Preview parent for line-box typography and
returns fractional `inlineLayout` allocation (`width`, `height`, `baseline`,
`paintOffsetX`, and `paintOffsetY`) plus optional `viewport` geometry
(`width`, `height`, `offsetX`, and `offsetY`) measured before capture
normalization, including custom `vertical-align` values such as `super`, `sub`,
and `middle`. PNG paint bounds do not define inline allocation. The outer
inline-block wrapper always owns the original allocation and line box. When a
viewport is present, the inner original source-root viewport owns
`auto`/`scroll`/`hidden`/`clip`; the PNG uses root-local union paint offsets
plus the viewport offset. The outer physical `margin-left` is owned once by
the wrapper and removed once from the local paint offset; vertical margin stays
allocation-only: source `vertical-align:top` and `bottom` retain their original
neighboring line-box keywords, while other modes use the measured allocation
`B-H` relation. Paint placement still uses only root-local union and viewport
offsets; no fixed offset is used. A
missing, non-finite, or out-of-bound allocation is an explicit
baseline/rasterization failure and never falls back to CSS's unmeasured
baseline.

For fraction and table-like KaTeX geometry, the native clone retains every safe
computed dimension and normal default, including computed `table-layout`; used
table bounds remain measurable so the browser can recompute intrinsic layout.

Block math keeps an intrinsic centered wrapper with local horizontal overflow:
the wrapper is block-level, width-constrained to the destination, centered with
auto margins, and scrolls horizontally while hiding vertical overflow. Its PNG
is block-level and centered by that wrapper. Source padding, borders,
background, and capture geometry are baked into the PNG once; they are not
copied again onto the wrapper or generated image.

Upload each generated PNG through the Editor's already selected
`ImageUploadPort`: Image Hosting when `imageHostingEnabled` is true, or the
protected WordPress Media Library owner when it is false. A selected-owner
failure never switches owner or publishes a partial Clipboard payload. There
is no compensating delete; PNGs uploaded before a later conversion, upload, or
Clipboard failure may remain under that owner's retention rules and the failure
must report that possibility. Copy never changes Markdown, `post_content`, the
live Preview, metadata, revisions, or publication state.

## Portable serialization

Clone only the received Preview surface. Remove scripts, styles, controls,
CSS classes, and editor/source transient attributes. Keep valid fragment IDs
and SVG-internal IDs, safe image `src`/`srcset`, safe link URLs, and approved
computed typography/layout. Remove unsafe URLs. Non-allowlisted CSS background
URLs become `none` layer slots while safe colors, gradients, and layer order
remain.
Portable output retains the safe computed inherited typography defaults that
WeChat would otherwise replace, on each node and pseudo-element:
`font-style`, `font-variant`, `font-stretch`, `letter-spacing`,
`text-transform`, `white-space`, `text-indent`, `text-shadow`, `tab-size`, and
`list-style-position`; layout defaults remain omitted. Anchors retain their
computed `text-decoration`, including `none`, rather than inheriting a
destination platform default. For this portable text rule, `overflow-wrap`
alone preserves its computed source value with
`!important` to outrank WeChat's global `word-wrap:break-word!important`
alias; there is no blanket `!important`, platform-value hardcoding, extra
computed read, or native PNG capture change.

For ordinary flow elements and generated pseudo-elements, map computed logical
`text-align:start` and `text-align:end` to physical `left` or `right` using the
source direction from computed style, the nearest `dir`, or the document. The
bounded raw tuple above is the only ordinary percentage-preservation exception:
its six dimensions and `box-sizing` are emitted as raw values, with
`!important` only on `box-sizing` and `max-width` in this dimension path. For
ordinary content-box values outside that tuple, WeChat's `border-box` rule is
handled by the existing projection path: finite pixels receive padding and
border widths, and percentage or `calc()` values retain CSSOM projection.
Intrinsic values and SVG, Math, KaTeX, and Mermaid special-layout geometry
retain their existing values.

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

An empty generated pseudo retains an invisible whitespace carrier only when no
image child is actually materialized. A safe non-repeating raster child itself
keeps the pseudo clone non-empty, so adding a preceding whitespace Text node is
forbidden: a block materialized image would otherwise start after the inherited
line box and paint outside the pseudo's fixed geometry. Repeating raster
backgrounds, gradients, colors, shadows, filtered SVG/remote URLs, and other
CSS-only empty decorations still retain the whitespace carrier because they do
not append an image child. Textual pseudo content remains unchanged. The modern
and synchronous serializers use the same actual-appended-layer decision.

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
element's display or margins. After safe computed styles and pseudo-elements
are captured, normalize copied article, div, and blockquote roots to portable
sections. Preserve blockquote borders, backgrounds, spacing, nested children,
and plain-text order; leave the source Preview unchanged. Wrap text leaves and
encode code-line breaks while keeping each source line non-wrapping.
Consume exactly one terminal LF or CRLF inside the copied `pre > code` before
materializing breaks: the source preformatted terminator does not paint an
extra row, while a terminal `br` plus empty `nobr` would. Preserve additional
intentional blank rows, nested token styles, indentation, and trailing spaces;
never change the source Preview, Markdown, or plain-text Clipboard output.
Group the existing copied code-line nodes in one block, intrinsic-width span
inside `code`, with a full content-width minimum and preformatted whitespace.
This preserves logical line breaks when WeChat rewrites the outer code's
whitespace, without adding a second scroll owner or changing token nodes.
Width checks use the code content box, excluding its border and padding.
Within copied `pre > code` only, protect eligible hash-token boundaries with
U+FEFF using WeChat's observed topic stop-character rule. Resolve the next code
point across syntax spans within the same normalized code line, never across
lines; retain authored FEFF and emoji variation/keycap sequences. U+2060 is
not a topic stop character. Body text, links and inline code are unchanged.
Track only changed Text nodes on the exclusive normalized root. Capture HTML
before plaintext measurement; temporarily restore their original values inside
the measurement `try` and restore their final encoded values in `finally`,
including generated spacing protection. Never globally strip authored FEFF.
Retain raw CSSOM `auto` and finite full-percentage margin tokens for ordinary elements, eligible
static/relative flow pseudos, and outermost ordinary/Mermaid SVG roots instead
of freezing the source viewport's used pixel margins. Other expressions retain
their existing used-value behavior. Only the four margin
axes change; fixed authored margins and other computed declarations remain
intact. Absolute pseudos, nested/internal SVG, and math/KaTeX geometry are
excluded. Raw margin semantics participate in initial, current, final, prepared,
and fallback freshness keys, so equal used pixels do not hide an `auto` to fixed
change. Refresh the raw style snapshot at each guarded serialization/signature
phase; never modify the live Preview or introduce fixed destination widths.
The generated, empty absolute `pre::before` frame decoration uses a portable
normal-flow header in the copied tree. Its band transfers the source's reserved
top padding; offsets, margins, dimensions, borders, and paint come from the
effective source styles. Only copied PRE top padding is transferred, and code
padding remains intact. Neither header nor marker depends on positioning that
the WeChat reader removes. Missing geometry, a nonpositive band, or a vertical
offset outside that band fails explicitly. Nonabsolute, hidden, absent, and
textual pseudos retain their existing behavior. Exclude only these generated
paint-only headers from connected plain-text measurement after HTML capture.
Within the dedicated generated frame-marker owner only, replace a sole Text
node containing one ASCII space with U+2060 so native Save retains its paint.
Keep other marker content, ordinary whitespace, other pseudos, Source and all
frame styles unchanged; the paint-only header still adds no plaintext character.
The PHP-generated H1-H4 prefix/content/suffix template may preserve an empty
painted suffix with one U+2060 Text node. Identify the complete ordered template
in the paired Source/clone walk; require an empty Source suffix, finite positive
geometry, its own visible computed state and background paint. Measurement-host
opacity does not suppress a valid candidate. After normalizing text leaves,
append only to a marked suffix still contained in the output and still empty.
Keep image, pseudo, authored, hidden, transparent and ordinary nodes unchanged.
Root-scoped export Text records restore its empty original value during connected
plaintext measurement and restore encoded values in `finally`, alongside the
fenced-code records; this must add no plaintext character or line boundary.
The paired pseudo serializer may apply the same transport only to a generated
H1-H4 `::after` whose parsed content is quoted empty, whose visible block-flow
box has positive emitted dimensions, and whose emitted CSS retains background
paint after URL filtering or materialization. Root, special-layout, textual,
hidden, transparent, absolute/fixed/sticky, zero-size, and unexportable pseudos remain on
the existing path. Replace only the generated clone's sole ASCII-space Text,
and register its exact space/U+2060 values with the same root Text owner. The
heading-after visibility input participates in freshness without widening
unrelated pseudo signatures.
Eligible empty H1-H4 `::before` decorations whose solid paint extends left of
the heading use a heading-local normal-flow carrier in the copied tree.
Qualification requires joint evidence: explicitly visible Source and pseudo,
finite opacity in `(0,1]`, a relative untransformed Source containing block
with zero borders and nonnegative top/left padding, a finite pure two-dimensional
pseudo translation, finite composed negative left extent, positive finite
paint width and height, zero pseudo padding and borders, and no image, shadow
or filter. Required offsets and margins must also resolve without fabricated
values. Zero-area, hidden, unsupported, invalid or unresolved candidates keep
their existing serialization path; they do not create a conversion expectation.
Derive the copied heading reserve and zero-outer-width float margins from the
Source extent, width and padding. Preserve paint, radius, opacity and used
vertical placement without adding article-wide padding or a fixed width.
Capture the exact cloned heading, carrier and expected geometry during the
paired walk; finalization checks their containment, parent and paint rather
than matching heading ordinals or arbitrary descendants. An established
conversion whose carrier or required paint is lost fails explicitly.
The generated paint-only carrier uses the existing root-scoped Text owner
with an empty original value and U+2060 transport. HTML capture precedes
plaintext normalization, which restores and then reinstates only that owned
Text record. Source remains unchanged. This transport requires independent
native Paste/Save retention verification; PRE or heading-after evidence does
not prove this before-carrier's native behavior or cross-width fidelity.
The exporter-owned portable root projection adds only `max-width:100%` and
`margin:0 auto` after computed Preview styles. This root-level declaration step
is separate from hidden-surface measurement, whose lease retains the original paper
geometry; it does not encode a fixed MDNice spacing value.

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
`container-type`, and `100cqi` pseudo-element geometry). Task-list state must
survive the native importer's removal of form controls. Materialize recognized
task markers from the current settled Preview paint into safe static Clipboard
output; preserve checked state, effective opacity, geometry and text alignment.
Task marker properties are normalized to one
`list-style-type:none!important` and one `list-style-image:none!important`
declaration before structural projection. A complete task list, meaning every
direct child item is a registered task item, is additionally projected to
destination-safe block structure before HTML capture: the `ul`/`ol` wrapper and each of its task items
become `section` elements that adopt the original attributes and children, so
every registered clone, static allocation, caption run, and caption structure
resolution keeps its identity. Each converted section replaces `display` and
`list-style-type`/`list-style-image` with `block`/`none!important` while keeping
the copied size and spacing declarations, and `start`, `reversed`, and item
`value` attributes survive on the converted structure. Ordinary lists and lists
that mix task and ordinary items keep native list markup; the exporter never
emits `ul > section` or `ol > section`. Projecting a mixed list into task
sections plus rebuilt ordinary list runs inside a legal block container remains
UNVERIFIED. Never change source controls, invent platform colors or
emoji, duplicate native list bullets, or keep an INPUT as proof of a
destination-visible state. Remove
arbitrary form controls. A marker that cannot be faithfully represented fails
explicitly rather than silently losing state; native-appearance themes require
their own verified normal path before all-theme acceptance. Retain each source table's authored/computed
`min-width`; only the generated scroll wrapper owns `min-width:0`, so the
table's intrinsic width is not compressed. Preserve source and table RGBA
colors from computed source styles without platform or theme color hardcoding.

The generated table scroll section, registered block-math scroll root, and
direct code scroll owner declare `data-ignore-width=""` after source attribute
sanitization. This is WeChat's documented intentional-local-overflow metadata;
it skips width checks only for that owner and its descendants, and changes
neither geometry nor content. Never inherit this attribute from
untrusted Preview content or emit it on the article root, PRE/header, or an
arbitrary element merely because its CSS scrolls. Unowned overflow remains
detectable. Real destination verification must prove complete local scrolling,
unchanged desktop/phone paint, and an unmarked overflowing negative case.
The [official WeChat plugin specification](https://developers.weixin.qq.com/doc/service/guide/product/plugin_spec.html)
owns the destination marker semantics. Its independent gradient/dark-mode
advice is not exempted by this width-only declaration.

## Failure and evidence

Private performance diagnosis uses fixed `easymde.wechat.copy.*` and
`easymde.wechat.rasterizer.*` User Timing names, numeric start/end times and
primitive kind, sync/async and terminal metadata. Clipboard candidate spans may
include their actual bounded ordinal; rasterizer spans correlate through the
enclosing serial candidate interval and do not invent an ordinal. Clear each
named measure immediately after emission. Unsupported timing must not change
the operation result, reads, scheduling, upload or Clipboard calls. Collect
measures and Long Tasks on the same document timeline with bounded observers;
record visibility transitions and report truncation. Async spans are elapsed
waits, not CPU measurements. Never include source, URLs, DOM, credentials or
content-derived identifiers in these measurements.

Copy success is reported only from the real browser result. On every legacy-path
exit restore temporary DOM, Selection, Focus, and Scroll. Do not mutate article
state. Adapter or preparation rejection remains explicit failure; no partial
payload is published. A WordPress Image Hosting action-Nonce rejection is a
whitelisted pre-write failure and reports `sideEffects: none`; arbitrary 403s,
unknown service codes, provider failures, network loss, Abort, invalid responses,
completed uploads, and mixed concurrent outcomes remain possible residual writes.
Never expose raw rejection messages, response bodies, credentials, or stacks.
Unexpected synchronous or asynchronous Clipboard adapter exceptions use the
fixed privacy-safe `wechat-copy-unexpected-error` diagnostic. If that result
arrives after session disposal, the session records that cause first and then
the fixed `wechat-export-completed-after-teardown` lifecycle diagnostic while
still suppressing every late UI status; an ordinary typed late result records
only the lifecycle diagnostic. Tests must cover
modern/legacy HTML parity, activation
timing, deferred failure, unsafe URL/style removal, theme-image timeout and
retry, hidden textual pseudo suppression across both Clipboard paths, Mermaid
non-ASCII labels, KaTeX/SVG preservation, table/formula overflow,
hidden-surface behavior, concurrent requests, active-surface changes, and
teardown. PNG-conversion tests additionally cover strict configuration and
transfer migration, exact candidate classification, no-upload background and
legacy paths, write-before-work activation timing, selected-owner dispatch,
limits, serial order, stale/cancel/timeout/failure behavior, residual-upload
reporting, ordinary/immersive invocation, native math margin and scroll-bound
capture, native `inlineLayout` allocation, optional viewport geometry, local
paint offsets, and paint-grid quantization, inline baseline variants and
explicit baseline failure, generated-image sizing inside the HTML overflow
owner, and single-owner block spacing. Use semantic readiness, not fixed
sleeps, and record unverified browsers or destination behavior honestly.
Native outside list markers with zero logical-start padding receive only a
browser-measured logical-start gutter in copied output so a destination root
with clipped overflow cannot hide them. Preserve native list tags, marker type,
`start`, `reversed`, item `value`, nesting, and hanging indentation. Existing
positive padding, task lists, custom counters/images/pseudos, mixed directions,
and non-horizontal writing remain unchanged. Measurement uses a temporary
native marker probe, participates in freshness, cleans up on every exit, and
fails explicitly when geometry is unavailable.
An exporter-generated direct text leaf immediately following a proven visible,
static inline `LI::before` text marker omits the internal `leaf` attribute and
keeps ordinary inline display. This prevents WeChat from upgrading that one
text run to a block `SECTION`; every other generated or authored leaf retains
the existing path. Eligibility is generation-owned and excludes tasks,
positioned/image/mask/counter decorations, special formatting owners,
intervening nodes, and ambiguous text runs.
For a generated task checkbox owner, a registered caption Text node may remain a
literal direct sibling only when it immediately follows that owner in the same
parent. This task-specific path omits both `leaf` and an inline wrapper so native
Save keeps the caption in the task item's inline formatting context. Nested
formatting, atomic elements, authored or unregistered text, intervening nodes,
and ambiguous ownership retain the existing text-leaf path; no other text leaf
may use this exception.
For an ordinary zero-spacing table, an opaque solid `THEAD` paint may be copied
onto otherwise transparent `TH` cells because WeChat removes group background
paint. Cell/row paint, images, gradients, alpha, row spans, contents layout, and
math/SVG tables remain unchanged. A separate ordinary table whose Source owns
`separate` borders, a positive radius, and two-axis `hidden`/`clip` retains that
collapse and clip metadata while the outer generated section remains the sole
horizontal scroll owner.
The ordinary dimension matrix must also cover modern/legacy parity for eligible
raw tuples, the seven-field grammar and positive percentage-edge requirement,
invalid `calc()`/negative/unit/zero-edge cases, and the excluded root, pseudo,
replaced, SVG/math/pre/code/table, formatting-owner, and visual-rasterization
cases. Warm and in-flight cases must change raw `box-sizing` or raw bounds at
equal used geometry and observe explicit freshness rejection or regeneration.
The native CSS allocation matrix remains required evidence for fractional and
superscript formulas; focused unit coverage does not prove final source-to-PNG
baseline fidelity.

The production admin entry statically imports the encoder worker with Vite's
`?worker&url` contract. The worker is compiled as an ES module into exactly one
local `assets/wechat-png-encoder-[hash].js` resource. Because Vite 8.1.5 does
not add this worker to the admin entry's native `assets` list, the WordPress
metadata owner explicitly records one non-entry worker manifest record and one
admin `resources` path. Production validation and the installable ZIP require
that exact resource and reject missing, altered, duplicate, or unowned worker
outputs.
