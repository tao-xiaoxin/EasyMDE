# User Guide

EasyMDE is a Markdown editor for WordPress posts and pages. New and existing supported posts and pages use EasyMDE through the normal WordPress editor entry points, while existing ordinary content is not converted or written until the author saves from EasyMDE.

## Open EasyMDE Posts And Pages

Use the normal WordPress content entries:

- **Posts > Add New**
- **Pages > Add New**
- The **Edit** link for an existing post or page

Those entries open the WordPress post editor screen with EasyMDE for supported post types. Existing posts that are already marked with `_easymde_enabled = 1`, or legacy posts that already have `_easymde_markdown` metadata, load stored Markdown. Existing ordinary posts without EasyMDE metadata import current `post_content` into Markdown in memory for the editor.

## Split Editor And Preview

The EasyMDE editor shows Markdown source on the left and a live preview on the right. The source and preview panes synchronize their scroll position so long articles remain easier to review while writing.

The preview uses the EasyMDE REST preview endpoint, which renders through the same server-side Markdown renderer used for saves. Loading, empty, and failure states remain visible; EasyMDE does not replace a failed formal Preview with a browser Markdown renderer.

Saving and publishing still use WordPress. EasyMDE mirrors the Markdown source into hidden post fields and, during a valid WordPress save, stores Markdown in `_easymde_markdown`, marks the post with `_easymde_enabled = 1`, and writes rendered compatibility HTML to `post_content`. Opening an ordinary existing post without saving does not create EasyMDE metadata, rewrite content, or create a revision.

## Toolbar And Shortcuts

The compact toolbar includes common Markdown actions for formatting, headings, quotes, lists, code, links, images, and Copy to WeChat. Keyboard shortcuts are Typora-inspired by default. Administrators can change Windows/Linux and macOS shortcut bindings from **Settings > EasyMDE**.

## Media Insertion

Use the image/media toolbar action to open the WordPress media library. After selecting one image, EasyMDE inserts Markdown image syntax using the attachment URL and available alt/title text.

When the current user can upload media, pasting a local clipboard image or
dropping a local image file into the Markdown source uploads that image and
inserts the configured Markdown or URL form only after the upload succeeds.
EasyMDE accepts local JPEG, PNG, GIF, and WebP images. The default destination
is the WordPress media library.

An administrator may instead choose **Remote image host** in **EasyMDE > Image
Hosting**, configure Cloudflare R2, save the settings, and test the saved
connection. Qiniu Kodo can be enabled as an optional same-key backup. Provider
credentials remain on the WordPress server and are not returned to the browser.
The settings page shows whether credentials are configured; entering a new key
replaces it on save, while an empty field keeps the stored value. Uploads are
not retried automatically. If the backup upload fails after R2 succeeds, the R2
URL remains usable and EasyMDE reports the partial failure. EasyMDE does not
offer an all-or-nothing mode because these providers do not expose a reliable
cross-provider rollback transaction.

If the WordPress media frame is unavailable, the command falls back to inserting Markdown image delimiters so the source text remains editable.

## Local Drafts And Recovery

EasyMDE stores editor drafts in the browser's `localStorage`, keyed by site, user, and post. If a newer local draft exists when the editor opens, EasyMDE shows restore and discard actions.

Local draft recovery is browser-local. Clearing browser storage, switching browsers, switching users, or editing from another device can make those local drafts unavailable. WordPress saves, revisions, autosaves, and publishing remain separate WordPress behavior.

## Themes, Code Themes, And Fonts

Each EasyMDE post can store:

- article theme;
- code theme;
- article font stack choices;
- custom CSS selection and snapshot.

The latest appearance choices are also saved as the current user's defaults for future EasyMDE posts.

Rendered source-code blocks use the built-in Mac-style frame as a fixed default. It is not a per-post or per-user setting, and its local stylesheet is loaded only when the rendered content contains a regular code block. Mermaid-only content does not load the ordinary code-frame or syntax-highlighting assets.

Article themes are explicitly registered local CSS files under `assets/themes/article/`. Code themes are either local Highlight.js vendor styles under `assets/vendor/highlight/styles/` or the EasyMDE-owned `assets/themes/code/wechat-inspired.css` and `assets/themes/code/terminal-noir.css` styles.

## Custom CSS

Named custom CSS styles are stored in the current user's custom CSS library. Creating, updating, or deleting full custom CSS requires the WordPress `unfiltered_html` capability.

Custom CSS is parsed with `sabberworm/php-css-parser`, normalized, scoped to EasyMDE-rendered content, and capped in size. The policy blocks unsafe or external-loading features such as `@import`, `@charset`, `@font-face`, `url(...)`, `expression(...)`, `behavior`, `-moz-binding`, and `javascript:`.

When a post uses a custom CSS style, EasyMDE stores a post-level snapshot so the published post can keep its appearance if the author later changes or removes the saved library item. If stored legacy CSS cannot be parsed safely, EasyMDE keeps the stored value but does not render unsafe scoped output.

## Mermaid, KaTeX, Syntax Highlighting, And TOC

EasyMDE ships local runtime assets for:

- Highlight.js syntax highlighting for code blocks.
- Mermaid rendering for fenced code blocks marked as `mermaid`.
- KaTeX rendering for inline and block math expressions.
- Table of contents output for `[TOC]` or `[toc]` on its own line.

Frontend pages load these assets only when the current EasyMDE post needs them. Mermaid, KaTeX, Highlight.js, and theme styles are not loaded from a CDN.

The table of contents is generated from rendered headings and is inserted where the `[TOC]` marker appears.

## Copy To WeChat

The **Copy to WeChat** action copies the current ready rendered preview as rich text. The modern Clipboard API writes normalized `text/html` and `text/plain` captured from the connected normalized export surface for the same preparation; plain text retains the Preview's paragraph and list line breaks, normalizes non-breaking spaces, removes U+2060 exporter markers, excludes removed editor/KaTeX MathML nodes, and never includes source transient attributes. Approved theme images are prepared after a debounced stable Preview update in a shared local cache limited to 32 assets; window/viewport resizes and immersive split-pane changes schedule the same refresh so the legacy payload is not stale after a layout-only change. If an image or video is still loading or changing intrinsic size, the modern write starts during the click and resolves its deferred payload afterward. Repeating theme backgrounds retain their materialized CSS background instead of becoming one flattened image. Background preparation failures stay quiet while editing and are reported by the actual copy attempt. Stable background preparation remains asynchronous even when no approved theme image needs materialization, so Mermaid/KaTeX-heavy articles do not monopolize the editor main thread. If `ClipboardItem` construction or `write()` throws synchronously during the originating click and no current prepared payload exists, the adapter makes one synchronous serialization attempt for the activation-safe legacy path. If preparation really is pending on an approved image, legacy remains an explicit failure until a current payload is ready; an asynchronously rejected modern write is never followed by an activation-losing legacy attempt. Empty, loading, or failed previews are not copied. The export removes editor-only nodes, inlines portable computed styles, preserves theme decorations and the visible KaTeX tree without duplicate KaTeX MathML, and keeps code lines, tables, and long display formulas horizontally scrollable when they exceed the WeChat column; inline formulas remain non-wrapping. Responsive bounds do not turn inline images or videos into centered block elements, and generated theme-image dimensions are not overwritten by those bounds. Mermaid flowchart labels are kept as complete single-line labels even when WeChat rewrites SVG `foreignObject` styles; exporter-only invisible markers are removed from plain text. It does not add a vertical scroll container around the article or change the post.

Background preparation notifications are coalesced per Preview: one full
serialization runs at a time, only the latest request is retained during that
run, and a short quiet delay separates replacements. This protects keyboard
resizing and rapid visual edits; its style and geometry walks periodically yield
to browser tasks so the editor remains interactive without relaxing the
freshness checks used by Copy.

The copy contract removes source/editor transient attributes; exporter-owned
`aria-hidden` decoration and `leaf` markers may remain as structural exceptions,
and “KaTeX MathML” below means only the generated `.katex-mathml` fallback tree,
not arbitrary MathML authored in Markdown.

Mermaid flowchart labels use a centered width expansion and intrinsic label width
before paste, so a wider WeChat font does not turn `用户请求` into a truncated
label. The export retains hidden SVG definition subtrees used by visible clip paths,
masks, gradients, and filters while removing unrelated hidden nodes. Tables are
centered at their intrinsic width inside a dedicated horizontal scroll region;
the table itself is not used as a `display:table` scroll owner. Theme table
layout shims and container-query decoration geometry remain in the copied HTML.
Markdown task-list checkboxes keep their checked/unchecked appearance as
disabled read-only controls, while unrelated form controls are removed.

Approved theme-image requests are aborted after ten seconds; a timeout is
reported as a copy failure and evicts the cached request for a later retry.

Modern plain-text extraction measures the connected export surface at the
rendered Preview width and reuses the last non-zero visible Preview width when
immersive source mode hides that surface. When WeChat export is disabled by the
site configuration, EasyMDE does not pre-serialize the Preview or fetch theme
images in the background. If a legacy copy follows a transient preparation
failure with no prepared entry, that click starts one background retry but
still reports failure; a later click can use the retry after it resolves.
Tables whose full-width behavior comes from the visible layout keep that
classification when the immersive source view hides the Preview, so switching
views does not narrow them during copy.

The full-capability verification fixture covers inline expressions, integral,
partial-derivative/limit, matrix, equation-system, piecewise, statistics,
neural-network, error-rate, and percentage formulas. A real authenticated
WeChat check compares the source Preview and pasted article for every registered
article theme and its registry-owned default code theme; one theme screenshot or
two formula cards is not complete parity evidence.

For portability, safe image `src`/`srcset` and link URLs may remain in the
copied HTML, including remote `<img>` URLs that the destination may choose to
load. Remote and non-allowlisted CSS background URLs become `none`
layer slots rather than importing remote resources, so safe gradients/colors
remain visible. Only same-origin
`/assets/images/` GIF/JPEG/PNG/WebP backgrounds are materialized, with the
same cache and source-size limits documented for administrators. Non-repeating
backgrounds keep safe gradient/color layers; the `background-repeat`,
`background-position`, and `background-size` longhands follow CSS's repeated
final-layer semantics and stay aligned after image layers are removed; and
multiple safe image layers keep their order and positioning after paste.
When a theme omits `background-size` or uses `auto`, the copied decoration
keeps the image's intrinsic size instead of stretching to the heading box;
`cover` and `contain` preserve their equivalent object-fit behavior. CSS edge
offsets such as `right 12px bottom 6px` retain both offsets.
Quoted pseudo-element text keeps its image behind the text, while empty
decoration pseudo-elements may retain an in-flow image footprint.
Pseudo-element
content is copied only when it is a quoted literal; CSS `attr()` and counters
are not portable. KaTeX MathML means the generated `.katex-mathml` tree here,
not arbitrary MathML authored in Markdown.

The layout observer reconciles inserted and removed Preview descendants; removed
images, videos, SVGs, and foreignObjects stop notifying immediately, and sink teardown
releases all remaining listeners and observers.

During a layout-only refresh, the legacy compatibility path keeps the last
resolved payload available until the replacement finishes, but only while the
Preview source markup is unchanged. A successful replacement becomes current;
a failed replacement restores the newest successful same-source payload, including
one completed by an older overlapping refresh. Content or root-markup changes
never copy the older payload.

When editing the Preview directly in immersive mode, EasyMDE coalesces preparation
after rapid accepted visual edits and refreshes after a stable Preview update,
so the copied HTML reflects the current surface without serializing the whole
article on every keystroke. The serializer checks the full current sink markup,
including root `class`/`style` attributes, before reusing a prepared payload, so
font or theme-only changes cannot reuse stale output. Responsive viewport,
computed-style, pseudo-element, and element-geometry changes also invalidate
the prepared payload. Preview image/video load, error, metadata, and resize
events, font loading completion/failure, and inserted descendants schedule the
  same refresh. Theme
 decoration dimensions, relative/absolute positioning, flex sizing,
 float/overflow, and box sizing are retained for non-root nodes. Fixed/sticky
 positioning is not reactivated by copied image decorations, and offsets inert
 under static positioning are cleared when an overlay containing block is
  created. Materialized background images remain behind copied text, preserve
  CSS single-token `background-size` aspect ratios, and are not clamped to a
  narrower host, and
 computed percentage background positions are normalized so centered image
 decorations remain centered after paste; single-token background positions use
 CSS's centered missing-axis default. Two-value keyword/offset positions follow
 CSS axis order (`left 10px` places the offset on the vertical axis and
 `top 10px` on the horizontal axis); explicit edge offsets retain the four-value
 form such as `right 12px bottom 6px`.
The preparation observer follows the active ordinary or immersive Preview
surface. If a theme or Custom CSS change exits immersive visual editing, the
refresh is queued after that editor surface is disposed and the remaining
Preview surface is ready; it never copies a disposed surface.
Stable Preview refresh notifications use the same active surface, so a hidden
ordinary Preview update cannot replace preparation for the editable visual
surface during a copy.

Modern copy is successful only after both the browser write and its deferred
HTML/plain-text payload resolve; a later theme-image or serialization failure
therefore remains an explicit copy failure. Stable Preview preparation remains
asynchronous even when no theme image is pending, so Mermaid/KaTeX-heavy
articles do not block the editor's main thread. If a browser throws while
constructing `ClipboardItem` or invoking `write()` synchronously, the click task
may make one synchronous serialization attempt for the activation-safe legacy
path when no current prepared payload exists. Browser support and permissions vary.
If the selected copy path fails, the editor shows an error message and leaves
the post content unchanged. Repeated clicks while a copy is pending share one
operation, and leaving the editor suppresses late success messages.

## Revisions And Deactivation

EasyMDE participates in WordPress revisions for Markdown and appearance metadata. Restoring an EasyMDE revision restores the Markdown/settings metadata and regenerates compatible HTML when the renderer is available.

If EasyMDE is deactivated, published posts retain the rendered HTML already stored in `post_content`. EasyMDE Markdown source and settings remain stored in post meta and can be used again if the plugin is reactivated.
