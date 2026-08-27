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

The current development default enables autosave every 30 seconds. Autosave
remains a WordPress-owned save path rather than a second browser persistence
authority.

## Toolbar And Shortcuts

The compact toolbar includes common Markdown actions for formatting, headings,
quotes, lists, code, links, images, and Copy to WeChat. The Settings Center
provides 19 bindings that match Typora's official common shortcut table for
Save, Bold, Italic, Strikethrough,
Paragraph, H1 through H6, Quote, Unordered List, Ordered List, Inline Code,
Code Block, Math Block, Link, and Image. Windows/Linux and macOS bindings are
configured separately. The source table is Typora's
[Shortcut Keys documentation](https://support.typora.io/Shortcut-Keys/).

Select a shortcut control and press the intended key combination; the control
records the real keyboard event and does not accept typed shortcut text. Clear
disables that one binding, while **Restore Default Shortcuts** restores all 19
defaults. Non-empty bindings always appear in toolbar and action hints.
Conflicting bindings on the same platform are highlighted immediately. Saving
while conflicts remain opens the **Shortcut conflict** dialog and does not
submit the settings. Return to the highlighted controls and assign distinct
combinations. WordPress validates the same invariant when it receives the
request.

Typora is a native desktop application, while EasyMDE runs inside the browser.
Chrome and other browsers may reserve exact Typora combinations such as
Ctrl/Cmd+1 through 6, Ctrl/Cmd+K, or Ctrl+Shift+I before a page receives the
keyboard event. EasyMDE still displays and restores the exact Typora defaults;
when a browser reserves one, record a different combination for that command.

## Media Insertion

Use the image/media toolbar action to open the WordPress media library. After
selecting one image, EasyMDE inserts Markdown image syntax using the attachment
URL and available alt/title text. This WordPress-native picker is an explicit
toolbar entry point; it does not own image paste or drag-and-drop uploads.

**Automatically upload pasted images** is enabled by default in **EasyMDE >
Image Hosting > Upload Behavior**. When enabled, pasting a local JPEG, PNG,
GIF, or WebP image file into either the ordinary Markdown source or immersive
editor uploads it through the protected same-origin Image Hosting path and
inserts the configured Markdown or URL form only after the upload succeeds.
When disabled, image-file paste does not call the upload endpoint and does not
insert a Base64 replacement. Ordinary text or HTML paste, the toolbar media
picker, and drag-and-drop upload are unaffected. There is no destination
selector or WordPress media-library fallback for pasted or dropped files.

**Remote image import** defaults to **Visual and source editors**. It applies
only to remote images contained in the current paste: the visual editor accepts
a pasted HTML `<img>` with an absolute HTTP or HTTPS `src`, and the source
editor accepts a pasted Markdown image with an absolute HTTP or HTTPS
destination. Choose **Visual editor only**, **Source editor only**, or **Do not
import** to limit or disable those two paths. Plain URLs, ordinary Markdown
links, relative or protocol-relative URLs, `data:` or `blob:` URLs, local
files, existing document images, opening an editor, and rendering Preview do
not trigger remote import. Local clipboard image files remain controlled only
by **Automatically upload pasted images**.

Eligible remote URLs are sent to a protected same-origin WordPress REST route;
the browser does not download their bytes directly. WordPress checks Nonces,
upload permission, and permission to edit the current post, rejects unsafe or
private destinations and redirects, and bounds download time and size before
verifying the actual allowed image type. EasyMDE inserts the configured image
syntax only after the existing Image Hosting runtime succeeds. A failed,
cancelled, or stale request leaves the later editor content unchanged and
shows the existing redacted upload failure state.

An administrator selects Cloudflare R2, Qiniu Kodo, Alibaba Cloud OSS, or
Tencent Cloud COS in **EasyMDE > Image Hosting**. **Verify Upload** validates
the current form without saving it by uploading the EasyMDE icon as a synthetic
PNG through the current file-name rule on the selected provider. Rules that use
time or UUID variables may create a new object on each verification.
The button remains disabled and shows its in-progress state until the result is
known. Success opens a structured Settings Center message dialog that confirms
the test-image upload, explains that the shown URL is inserted into articles,
and lists the uploaded object path and primary Viewing Image Domain URL.
Failure states that no article image URL was created, shows the redacted error,
and asks the administrator to check the configuration before verifying again. Any
supported provider can be the primary or the optional
backup. Primary and backup writes always use the same generated object key;
there is no setting for changing that invariant. **Upload Retry Count** appears
once in the primary settings, accepts `0` through `5`, and defaults to `0`, so
protected uploads are not retried automatically unless an administrator
explicitly opts in.
That one value is the number of extra serial attempts after a destination's
first failed write and applies to both primary and enabled backup writes. Every
attempt uses the same image bytes, object key, and provider, and stops after the
first success. **Verify Upload** is never retried. If the
primary exhausts its attempts, or an enabled backup exhausts its attempts, the
whole article upload fails: EasyMDE inserts no URL and opens an accessible
error message asking the author to retry manually. Repeated requests may
overwrite the same stored object and may incur provider request charges; an
object may remain after failure because cross-provider rollback is unavailable.
Without a valid saved primary configuration, drag-and-drop and enabled
automatic image paste fail explicitly. Provider credentials
remain on the WordPress server during ordinary settings reads. The settings
page shows whether credentials are configured; entering a new key replaces it
on save, while an empty field keeps the stored value. An administrator can use
the eye control to explicitly retrieve the corresponding saved Access Key or
Secret Key. That one-field response is not cached, is kept only in the current
page's memory, and is not saved to browser Storage, bootstrap data, exports, or
logs.

Newly entered credentials are sent only through the protected same-origin
verification request to WordPress. If the fields are blank, WordPress may reuse saved
credentials only when the settings revision and physical destination still
match; changing the destination requires entering its credentials.

R2, OSS, and COS use one provider API endpoint field. For OSS and COS, the
plugin derives the signing region from the validated official HTTPS endpoint; the
region is not entered or stored separately. Use the provider's standard public
service endpoint, such as `https://oss-cn-hangzhou.aliyuncs.com` for OSS or
`https://cos.ap-shanghai.myqcloud.com` for COS.
These HTTPS provider API Endpoints are used only for upload requests. The separately
configured primary Viewing Image Domain may use HTTP or HTTPS and is the public
URL base used after upload. EasyMDE returns and inserts one authoritative URL
built from that domain and the generated object key. An HTTP image URL can be
blocked as mixed content when the article itself is viewed over HTTPS; this is
a browser display restriction, not an upload failure. The verification dialog
warns about that risk. A backup provider writes the same object key but does
not replace the URL displayed in the article.

The primary and backup must not identify the same physical provider bucket.
EasyMDE rejects a duplicate destination with a message before it can be saved
or used. Article primary and backup writes use the configured bounded attempts
described above; verification uses one attempt, and no operation switches
providers. Exhaustion is the strict whole-upload failure described above.
EasyMDE
does not offer an all-or-nothing mode because these providers do not expose a
reliable cross-provider rollback transaction.

The `{md5}` filename variable is the lowercase hexadecimal MD5 digest of the
final bytes sent to the provider, after any enabled image processing. This
matches PicFast PicGo's content-MD5 algorithm; EasyMDE derives the extension
from the verified MIME type rather than trusting the original filename. The
default file-name rule is `{year}/{month}/{md5}.{ext}`, and the default image
title setting is **Leave Empty**, so inserted Markdown has no title unless the
administrator changes it.

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
