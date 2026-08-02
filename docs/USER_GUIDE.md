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

When the current user can upload media, pasting a local clipboard image or dropping a local image file into the Markdown source uploads that image to the WordPress media library and inserts Markdown image syntax after the upload succeeds. EasyMDE accepts local JPEG, PNG, GIF, and WebP images; remote image-provider uploads are not used.

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

The **Copy to WeChat** action copies the current ready rendered preview as rich text. The modern Clipboard API writes normalized `text/html` and `text/plain` captured from the connected normalized export surface for the same preparation; plain text retains the Preview's paragraph and list line breaks, excludes removed editor/MathML nodes, and removes exporter-only whitespace markers. Approved theme images are prepared after a debounced stable Preview update in a shared local cache limited to 32 assets; window/viewport resizes and immersive split-pane changes schedule the same refresh so the legacy payload is not stale after a layout-only change. If an image or video is still loading or changing intrinsic size, the modern write starts during the click and resolves its deferred payload afterward. Repeating theme backgrounds retain their materialized CSS background instead of becoming one flattened image. Background preparation failures stay quiet while editing and are reported by the actual copy attempt. The older compatibility path is available only when that same normalized payload is already prepared and can be selected synchronously in the click task. A click while preparation is pending, an unavailable legacy path, or an asynchronously rejected modern write reports failure; a synchronous `ClipboardItem` or `write()` setup failure may use the prepared legacy payload in that same click task. EasyMDE never awaits and then falls back to legacy after activation is lost. Empty, loading, or failed previews are not copied. The export removes editor-only nodes, inlines portable computed styles, preserves theme decorations and the visible KaTeX tree without duplicate KaTeX MathML, and keeps code lines, tables, and long display formulas horizontally scrollable when they exceed the WeChat column; inline formulas remain non-wrapping. Responsive bounds do not turn inline images or videos into centered block elements, and generated theme-image dimensions are not overwritten by those bounds. Mermaid flowchart labels are kept as complete single-line labels even when WeChat rewrites SVG `foreignObject` styles; exporter-only invisible markers are removed from plain text. It does not add a vertical scroll container around the article or change the post.

The layout observer reconciles inserted and removed Preview descendants; removed
images, videos, SVGs, and foreignObjects stop notifying immediately, and sink teardown
releases all remaining listeners and observers.

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
decoration dimensions,
positioning, flex sizing, float/overflow, and box sizing are retained for
non-root nodes; materialized background images remain behind copied text, and
computed percentage background positions are normalized so centered image
decorations remain centered after paste.
The preparation observer follows the active ordinary or immersive Preview
surface. If a theme or Custom CSS change exits immersive visual editing, the
refresh is queued after that editor surface is disposed and the remaining
Preview surface is ready; it never copies a disposed surface.

Modern copy is successful only after both the browser write and its deferred
HTML/plain-text payload resolve; a later theme-image or serialization failure
therefore remains an explicit copy failure. Browser support and permissions
vary. If the selected copy path fails, the editor shows an error message and
leaves the post content unchanged. Repeated clicks while a copy is pending
share one operation, and leaving the editor suppresses late success messages.

## Revisions And Deactivation

EasyMDE participates in WordPress revisions for Markdown and appearance metadata. Restoring an EasyMDE revision restores the Markdown/settings metadata and regenerates compatible HTML when the renderer is available.

If EasyMDE is deactivated, published posts retain the rendered HTML already stored in `post_content`. EasyMDE Markdown source and settings remain stored in post meta and can be used again if the plugin is reactivated.
