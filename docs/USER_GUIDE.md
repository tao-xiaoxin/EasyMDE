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
editor sends it through the selected protected same-origin upload owner and
inserts the configured Markdown or URL form only after the upload succeeds.
With Image Hosting enabled, that owner is Image Hosting; with it disabled, the
WordPress Media Library `/media` owner handles the upload. The saved File Name
Rule is used by both owners for future EasyMDE paste/drop uploads, so it remains
visible and configurable even while Image Hosting is disabled.
When **Automatically upload pasted images** is disabled, image-file paste does
not call the upload endpoint and does not insert a Base64 replacement. Ordinary
text or HTML paste and the toolbar media picker are unaffected. Drag-and-drop
retains its existing upload behavior and uses the selected owner and File Name
Rule. The rule does not move historical attachments or change the explicit
native media-picker insertion path.

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

EasyMDE shows a checking state while the protected WordPress route compares an eligible pasted URL with the configured primary Viewing Image Domain.
When the URL uses the exact same scheme and case-insensitive canonical ASCII hostname, EasyMDE reports that the image is already hosted, keeps the original URL and path, and performs no remote download or primary, backup, or other image-host storage write.
User information, explicit ports, queries, fragments, trailing-dot aliases, Unicode/IDNA guesses, suffixes, subdomains, provider endpoints, CDN aliases, and the backup Viewing Image Domain do not qualify as already hosted and continue through normal remote-import validation.

Eligible remote URLs are sent to a protected same-origin WordPress REST route; the browser does not download their bytes directly.
For an imported result, WordPress checks Nonces, upload permission, and permission to edit the current post, rejects unsafe or private destinations and redirects, and bounds download time and size before verifying the actual allowed image type.
EasyMDE inserts newly hosted image syntax only after the existing Image Hosting runtime succeeds.
A failed, cancelled, or stale request leaves the later editor content unchanged and shows the existing redacted upload failure state.

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

The File Name Rule supports `{year}`, `{month}`, `{day}`, `{date}`, `{time}`,
`{post_id}`, `{md5}`, `{uuid}`, `{name}`, and `{ext}`. Date and time variables
use UTC; `{post_id}` is the associated post ID (or `0` when there is no post),
`{uuid}` is generated for the upload, `{name}` is the sanitized original file
stem, and `{ext}` comes from the verified MIME type. `{md5}` is the lowercase
hexadecimal digest of the exact bytes used by the selected upload owner. The
default rule is `{year}/{month}/{md5}.{ext}`, and the default image title
setting is **Leave Empty**, so inserted Markdown has no title unless the
administrator changes it. WordPress remains responsible for final unique
filenames, attachment metadata, sub-sizes, and URLs in its Media Library.

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

Choose **Copy to WeChat** when the rendered Preview is ready. EasyMDE copies the current Preview as rich text, and the ordinary editor and immersive editor use that same current Preview.

**Convert and upload images for WeChat copy** is disabled by default under
**EasyMDE > Image Hosting > Upload Behavior**. When enabled, an explicit Copy
converts the outermost rendered Mermaid diagrams and inline or block formulas
to PNG. Normal tables remain editable HTML; existing images, ordinary SVG,
code, other media, and unknown content keep their existing rich-text form.
EasyMDE does not upload during Preview or background preparation.

Generated PNGs use the same upload owner already selected for editor images:
Image Hosting when enabled, or the WordPress Media Library when disabled. A
failure does not switch owners and no partial Clipboard content is reported as
success. PNGs uploaded before a later conversion, upload, or Clipboard failure
may remain in the selected storage. Copy never changes Markdown, saved content,
or the live Preview. PNG conversion requires the modern browser Clipboard API;
unsupported or legacy-only paths fail explicitly without uploading.

- **Ready:** The action copies the current rendered Preview and reports success only after the browser confirms the copy.
- **Empty, loading, or error:** The action does not copy and shows that the Preview is unavailable; wait until the Preview is ready and try again.
- **Unsupported:** If the browser cannot provide clipboard support, EasyMDE reports that the action is unsupported.
- **Failure:** EasyMDE shows an explicit error, does not claim success or produce partial output, and leaves the article unchanged.
- **Success:** EasyMDE reports a successful copy without saving, publishing, or otherwise changing the article.

The WeChat export implementation contract is owned by the [EasyMDE WeChat export reference](../.agents/skills/easymde/references/wechat-export.md), current architecture facts are routed through [ARCHITECTURE.md](ARCHITECTURE.md), focused test and browser-evidence procedures are routed through [TESTING_AND_RELEASE.md](TESTING_AND_RELEASE.md), and the decision rationale is recorded in [ADR-001](decisions/ADR-001-wechat-clipboard-serialization.md).

## Revisions And Deactivation

EasyMDE participates in WordPress revisions for Markdown and appearance metadata. Restoring an EasyMDE revision restores the Markdown/settings metadata and regenerates compatible HTML when the renderer is available.

If EasyMDE is deactivated, published posts retain the rendered HTML already stored in `post_content`. EasyMDE Markdown source and settings remain stored in post meta and can be used again if the plugin is reactivated.
