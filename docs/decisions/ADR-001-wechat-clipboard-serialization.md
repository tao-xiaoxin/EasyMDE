# ADR-001: Portable WeChat Clipboard Serialization

- Status: Accepted
- Date: 2026-08-02
- Owners: EasyMDE React browser integrations and Preview

## Context

EasyMDE's Preview is a browser document with theme CSS, computed layout,
Highlight.js token spans, KaTeX's visual and KaTeX MathML trees, pseudo-element
decorations, local theme images, tables, and code frames. WeChat does not share
that CSS or DOM environment. Copying `innerHTML` therefore loses theme details,
allows destination rules to reflow code and formulas, and can import both KaTeX
trees. Two independent copy implementations would also allow browser support
paths to drift.

Copy is an author-initiated compatibility operation. Markdown, WordPress
`post_content`, metadata, revisions, and publication remain server-owned and
must not be changed by it.

## Decision

`createBrowserWechatClipboard` is the single browser serializer. The
EditorRoot/session passes it only the current stable, sanitized, locally
enhanced Preview Safe HTML sink; the Adapter itself accepts an HTMLElement and
does not establish a second document authority. It builds one normalized clone.
Both the modern `navigator.clipboard.write` path and the legacy
`document.execCommand('copy')` compatibility path use the same HTML. The modern
path writes `text/plain` from the connected normalized export surface captured
for that same preparation after removing exporter whitespace markers and
normalizing non-breaking spaces; its off-screen measurement host uses the
rendered Preview width and reuses the last non-zero visible width while
immersive source mode hides that surface. The legacy path selects that same
HTML and lets the destination derive visible plain text. EditorRoot does not
schedule background preparation or theme-image fetches when bootstrap disables
WeChat export.

Stable Preview notifications schedule one debounced preparation after the
Preview settles; this may prewarm the bounded same-origin theme-image cache
shared by preparation and Copy (at most 32 entries). If an approved image
is still pending at the click, the modern path supplies deferred `Blob` Promises to one
`ClipboardItem` and starts `navigator.clipboard.write` in the originating
activation task. Preparation retains one serialized HTML/plain-text payload for
the current Preview sink and binds each stable notification to the active
ordinary or immersive surface. A hidden ordinary Preview refresh cannot cancel
preparation for an editable visual surface. When no approved theme image needs
asynchronous materialization, the modern path still consumes the asynchronous
prepared payload; stable background preparation never performs a synchronous
full-Preview serialization. If `ClipboardItem` construction or `write()`
invocation throws synchronously and no current prepared payload exists, the
adapter may make one synchronous serialization attempt in that same copy task
so the activation-safe legacy path can invoke `execCommand` without crossing
an activation boundary. If approved image preparation is still
pending, modern Clipboard receives deferred Blob values and legacy remains an
explicit failure until a prepared payload exists. If modern writing rejects
after an await, the operation fails explicitly rather than entering legacy after
the activation window. Copy reports success only after both the browser write and
deferred HTML/plain-text payload resolve; preparation or conversion failures
never produce partial output.
Window/viewport resize and immersive split-pane changes schedule a refreshed
payload, so layout-only changes cannot strand a stale legacy copy. During a
replacement, the last resolved payload remains available to legacy only when
the source markup is unchanged; a successful replacement supersedes it, a
failed replacement restores the newest successful same-source payload,
including one resolved by an older overlapping refresh, and changed source
markup never reuses it. Preparation generations are monotonic: an older
completion cannot overwrite a newer successful same-source fallback. The
layout fingerprint ignores viewport-relative `left`/`top`/`right`/`bottom`
coordinates so ordinary page scrolling does not invalidate a payload, while
dimensions and computed styles that can change wrapping still do.
Background preparation failures remain quiet until the actual copy attempt
reports the failure. If legacy has no prepared entry after a transient
preparation failure, that click starts one background retry but still returns
failure; a later click may use it only after it resolves. Approved theme-image
fetches have a ten-second abortable timeout;
timeout evicts the pending cache entry instead of leaving serialization
pending forever. The browser environment also observes Preview image/video
load, error,
metadata, and resize events, FontFaceSet loading completion/failure,
ResizeObserver geometry, and inserted or removed descendants; these post-render
layout changes schedule the same refresh, removed nodes are unobserved
immediately, and the observers are cleaned up with the Preview sink.
The EditorRoot binds that observer to the actual ordinary or immersive Preview
surface. A theme or Custom CSS change that first exits visual editing waits for
the refreshed ordinary Preview snapshot after visual runtime teardown, so legacy
Copy never uses a stale or disposed surface.
EditorRoot marks these observer and snapshot notifications as background
preparation. The adapter runs at most one full serialization per sink, retains
only the latest request while it is active, and waits for a short quiet delay
before replacing it. Background style and geometry walks also yield to browser
tasks periodically, keeping rapid split-pane keyboard changes responsive while
preserving the full freshness checks used by Copy.
Immersive visual edits coalesce preparation after rapid input, and later stable
Preview notifications replace the prepared payload before another copy. The
serializer compares the full sink markup, including root `class`/`style`
attributes, plus the current viewport, computed export styles, pseudo-element
styles, and element geometry before reuse, so font/theme-only changes,
responsive layout changes, and immersive edits cannot reuse HTML captured when
the surface was first opened or before a later edit.

The normalized payload:

- removes scripts, styles, interactive controls, CSS classes, and source/editor
  transient attributes; preserves only valid fragment IDs and SVG-internal IDs.
  Serializer-generated `aria-hidden` decoration and `leaf` markers are
  intentional structural exceptions;
- validates URL and style values. Safe image `src`/`srcset` and link URLs may
  remain. Remote and non-allowlisted CSS background URLs become `none` layer
  slots instead of crossing the paste boundary. Only same-origin
  `/assets/images/` GIF/JPEG/PNG/WebP backgrounds are materialized as bounded
  data images;
  repeating theme backgrounds retain their materialized `background`
  declaration rather than being flattened to one `<img>`;
  non-repeating multi-layer backgrounds retain non-image layers such as
  gradients, while every safe image layer is materialized in source order with
  its matching size, position, and isolated stacking level;
  bounded to 32 cache entries and by the fetched source blob limit
  `MAX_DATA_IMAGE_LENGTH` = 4,000,000;
  safe image `src`/`srcset`
  candidates and link URLs remain while unsafe URLs are removed. Remote
  `<img>`/`srcset` candidates are retained but are not fetched by the
  serializer. The copied
  `background-repeat`, `background-position`, and `background-size` longhands
  are expanded using CSS's repeated-final-layer semantics and compacted by the
  removed image indexes so they stay aligned with retained layers;
- preserves approved computed typography, borders, and quoted-literal
  pseudo-element decorations; visible quoted pseudo-element text keeps its
  image behind the text in an isolated negative stacking level, while empty
  decorations may retain an in-flow image footprint. `attr()`, counters, and other non-literal
  pseudo-element content are intentionally not portable. It retains non-root
  theme decoration dimensions/relative/absolute positioning/flex sizing/float/overflow and box
  sizing, code-frame geometry, table structure, responsive non-math SVG and
  media bounds without changing inline media display or margins, and KaTeX's
  visual SVG geometry while removing only the `.katex-mathml` tree; hidden SVG
  `<defs>` subtrees remain for visible clip-path/mask/gradient/filter
  references, while unrelated hidden nodes are removed; materialized
  background images use an isolated
  negative stacking level so they remain behind copied text; computed `0%`,
  `50%`, and `100%` background positions are normalized before composing
  centered theme-image overlays; single-token `background-position` values use
  CSS's centered missing-axis default. Two-value keyword/offset positions follow
  CSS axis order (`left 10px` uses the vertical offset and `top 10px` uses the
  horizontal offset); explicit edge offsets retain the four-value form.
  Fixed/sticky positioning is never reactivated
  by a generated overlay, and offsets inert under static positioning are
  neutralized when the exporter creates a relative containing block; generated theme-image `<img>` nodes retain
  their explicit background dimensions and are excluded from generic media
  bounds. A single numeric `background-size` token keeps its missing axis
  automatic; omitted or `auto` sizing remains intrinsic rather than inheriting
  the host box, while `cover` and `contain` map to equivalent `object-fit`
  sizing. CSS edge-offset positions such as `right 12px bottom 6px` retain
  both edge and offset values. Materialized theme images use an unconstrained
  max width so fixed decorations wider than their host remain complete;
  exporter-owned `aria-hidden` decoration and `leaf` markers remain as
  structural exceptions;
- treats Mermaid HTML-label SVGs as a destination-font compatibility boundary:
  only Mermaid roots and their `foreignObject` labels receive visible overflow,
  semantic non-wrapping structure, and zero-width word-joiner markers. Numeric
  label boxes expand around their original center by at least 32px or 1.5x and
  their XHTML label containers use intrinsic `max-content` sizing because the
  destination font may be wider than the Preview font. WeChat may remove the
  label CSS and `<nobr>` while sanitizing the paste, so the marker path is
  required for complete labels; modern `text/plain` removes the markers and
  ordinary SVG/KaTeX paths remain unchanged;
- normalizes article/div roots to portable section structure, wraps text leaves,
  preserves code and KaTeX whitespace markers, and sanitizes `srcset` and
  fragment IDs together with ordinary URL attributes;
- encodes code line breaks explicitly and keeps each source line non-wrapping;
- centers tables and display formulas in the destination column and applies
  horizontal-overflow rules to code, table, and formula frame boundaries. Each
  table is wrapped in a real block scroll owner and retains intrinsic
  `max-content` sizing; `display:table` is never treated as the scroll owner.
  For tables whose full-width state is inferred from rendered geometry, the
  serializer retains the source table's last visible classification while
  immersive source mode hides the Preview pane; the next visible layout pass
  refreshes that classification.
  Theme table shims (`display:contents`, `container-type`, and `100cqi`
  pseudo-element geometry) remain intact. Task-list checkboxes retain checked
  state as disabled, attribute-minimized controls while arbitrary form
  controls are removed. Browser evidence identifies the actual owner and
  rejects nested vertical scrolling;
- keeps card height content-driven and does not create an article-wide height or
  vertical scroll container.

The legacy path is a compatibility branch inside the same explicit user action,
not a second renderer or a silent success. It consumes a payload prepared before
the click. Only a synchronous `ClipboardItem`/`write()` setup failure with no
current prepared payload may trigger one synchronous serialization attempt in
that click task; it never awaits theme-image work in the click handler. If
`ClipboardItem` construction or the `write()` call throws synchronously, that
same click task may use the current prepared payload; a modern write rejection
after an await remains a failure rather than an asynchronous legacy fallback.
Clipboard failure remains a failure; temporary fallback DOM, Selection, Focus,
and Scroll are restored on every exit.

`createWechatExportSession` is the single session owner shared by the ordinary
and immersive editor surfaces. It checks the enabled/active state and current
Preview readiness before invoking the serializer, coalesces concurrent copy
requests, maps Adapter rejection to `wechat-copy-failed`, distinguishes
`wechat-clipboard-unsupported`, and suppresses status after teardown. Empty,
loading, or failed Preview surfaces return `wechat-preview-unavailable` without
touching Clipboard. A rejected same-origin theme-image fetch or data conversion
fails the operation rather than producing partial output.

## Alternatives Rejected

- Copying raw Preview `innerHTML`: destination CSS and duplicate KaTeX MathML
  make the result unstable and unsafe.
- Maintaining separate modern and legacy serializers: browser-dependent output
  drift would be invisible until a user pasted into WeChat.
- Rendering Markdown again in the browser: it would create a second content
  authority and diverge from the server Preview.
- Fixing WeChat with a global page height or overflow rule: that masks the
  owning boundary, clips legitimate long content, and confuses WeChat page
  navigation with copied article layout.

## Consequences

The HTML payload is larger because portability requires inline declarations and
explicit line structure. Changes to Preview enhancement, theme decoration,
KaTeX, code frames, tables, or scroll ownership require focused serializer
tests and fresh browser screenshots in an authorized local WeChat session.
The page-level scrollbar of a long WeChat editor is measured separately and is
not attributed to the exporter without a current-session article scroll owner.
All runtime assets remain local; no remote executable resource is introduced.

## Verification

The focused serializer tests cover unsafe input, pseudo elements, theme-image
materialization, delayed modern Clipboard activation, Mermaid non-ASCII label
preservation plus center-preserving width expansion, code line preservation, intrinsic table scroll-owner and
theme-shim behavior, task-list checkbox state, table/formula horizontal overflow, KaTeX
MathML removal, modern/legacy HTML parity, synchronous legacy preparation for
payloads without remote theme images, synchronous modern setup fallback,
rejection without asynchronous legacy fallback, deferred payload failure after
a fast write, and an explicit failure result with sandbox cleanup. The timeout
and cache-eviction regression covers a permanently pending approved image
request. The suite also covers CSS single-token and two-value keyword/offset
background-position defaults, scroll-only geometry reuse, retry completion
without fixed delays, and out-of-order preparation generations preserving the newest successful
fallback. Non-2xx responses, invalid MIME/size, FileReader conversion errors,
unsupported legacy results, an asynchronous modern rejection followed by a
successful legacy attempt, and full Selection/Focus/Scroll restoration on
every failure path remain explicit follow-up cases; they must fail visibly and
must not produce partial output. The companion
session tests cover concurrent single-flight, unsupported results, and late
teardown; disabled/inactive and all Preview-readiness variants remain required
boundary cases. The full frontend checks validate the compiled admin bundle and
manifest; release checks ensure the compiled runtime is self-contained.
Real-browser evidence uses the synthetic full-capability fixture, compares
source Preview with pasted WeChat screenshots, measures the actual scroll
owners, and never publishes or sends an article.
