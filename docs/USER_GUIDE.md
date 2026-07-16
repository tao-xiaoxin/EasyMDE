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

The preview normally uses the EasyMDE REST preview endpoint, which renders through the same server-side Markdown renderer used for saves. If the browser cannot use the REST preview path, the editor shows an escaped fallback preview instead of silently inserting unsafe HTML.

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

## Immersive Writing

The normal WordPress edit screen remains unchanged until the author selects **Enter immersive writing**. That action opens an isolated full-screen article workspace with title editing, edit/split/preview modes, outline navigation, local statistics, responsive panes, themes, fonts, media, revision history, and native WordPress save and publish controls. Outline navigation and the compact statistics panel are off by default; the statistics panel computes line, Western-word, CJK-character, total-character, and deterministic reading-time values locally without sending or storing article content.

The workspace keeps the existing WordPress title and EasyMDE Markdown fields as the source of truth. Closing it with the visible exit action or Escape returns to the original edit screen with the current title and Markdown intact. Opening and cancelling the publish dialog does not write post fields; confirmed publishing continues through the native WordPress form, nonce, capability, taxonomy, media, and revision paths.

## Themes, Code Themes, And Fonts

Each EasyMDE post can store:

- article theme;
- code theme;
- article font stack choices;
- custom CSS selection and snapshot.

The latest appearance choices are also saved as the current user's defaults for future EasyMDE posts.

Rendered source-code blocks use the built-in Mac-style frame as a fixed default. It is not a per-post or per-user setting, and its local stylesheet is loaded only when the rendered content contains a regular code block. Mermaid-only content does not load the ordinary code-frame or syntax-highlighting assets.

Article themes are explicitly registered local CSS files under `assets/themes/article/`. Code themes are either local Highlight.js vendor styles under `assets/vendor/highlight/styles/` or the EasyMDE-owned `assets/themes/code/wechat-inspired.css` style.

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

The **Copy to WeChat** action copies the current rendered preview as rich text. When browser APIs allow it, EasyMDE writes both `text/html` and `text/plain` clipboard payloads. Before copying, it clones the preview, removes script/style elements, inlines important computed styles, and uses the sanitized rendered preview content.

Browser support and permissions vary. If the modern Clipboard API is blocked or unavailable, EasyMDE tries the older copy path. If neither path works, the editor shows an error message and leaves the post content unchanged.

## Revisions And Deactivation

EasyMDE participates in WordPress revisions for Markdown and appearance metadata. Restoring an EasyMDE revision restores the Markdown/settings metadata and regenerates compatible HTML when the renderer is available.

If EasyMDE is deactivated, published posts retain the rendered HTML already stored in `post_content`. EasyMDE Markdown source and settings remain stored in post meta and can be used again if the plugin is reactivated.
