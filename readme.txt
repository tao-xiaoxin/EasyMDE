=== EasyMDE ===
Contributors: tao-xiaoxin
Tags: markdown, editor, writing, preview, wechat
Requires at least: 6.7
Tested up to: 7.1
Requires PHP: 7.4
Stable tag: 0.1.8
License: Apache-2.0
License URI: https://www.apache.org/licenses/LICENSE-2.0

A standalone WordPress Markdown editor with split-pane live preview, local rendering tools, themes, and WeChat rich-text export.

== Description ==

EasyMDE opens new and existing supported WordPress posts and pages in a Markdown editing surface through the normal editor entry points. Existing ordinary content is not converted or written on open; EasyMDE state is established on the next legitimate save.

Write Markdown on the left and review a live preview on the right. EasyMDE provides commonly used writing tools, media insertion, local rendering support, article themes, code highlighting, and rich-text export for the WeChat Official Accounts editor.

EasyMDE is self-contained and does not require Jetpack, Classic Editor, another Markdown plugin, or external CDN assets.

== Features ==

* Split-pane Markdown source editing and live preview.
* Scroll synchronization between source and preview panes.
* Compact icon toolbar for common Markdown formatting actions.
* Heading, appearance, and output controls in compact popovers.
* Typora-inspired keyboard shortcuts with configurable Windows/Linux and macOS bindings.
* Explicit WordPress media library insertion through the toolbar media picker.
* Local image paste and drag-and-drop upload through the protected same-origin Image Hosting path to administrator-configured Cloudflare R2, Qiniu Kodo, Alibaba Cloud OSS, or Tencent Cloud COS; any provider can be primary or the optional same-object-key backup, with no WordPress media fallback or automatic retry.
* REST-powered server preview.
* Browser local draft autosave and recovery.
* Fixed 50/50 desktop source/preview workspace with the historical responsive stack at narrow widths.
* WordPress-native publishing, categories, tags, excerpts, featured images, and revisions remain available in their existing Meta Boxes.
* Local Highlight.js code highlighting.
* Local Mermaid diagram rendering.
* Local KaTeX math rendering.
* `[TOC]` and `[toc]` table of contents generation.
* Per-post article themes and code themes.
* Fixed Mac-style framing for rendered source-code blocks, loaded only when needed.
* Per-post article font stack selection.
* Named reusable custom CSS styles.
* Rich-text “Copy to WeChat” export from the rendered preview.
* Markdown source stored in post meta and rendered HTML stored in post content.
* No activation redirect and no unrelated admin-page redirect.

== Themes and Appearance ==

EasyMDE includes multiple built-in article themes inspired by locally bundled writing layouts and mdnice-style designs. Themes are implemented locally with scoped CSS and do not load remote decorative assets.

Article theme, code theme, font stack, and custom CSS choices are saved per post. The current user's latest appearance choices are reused as defaults for future posts. The Mac-style source-code frame is a fixed rendering default rather than saved appearance state.

The editor includes article themes such as:

* Default
* Orange Heart
* Chazi Purple
* Green Vitality
* Red Crimson
* Blue Ying
* Lanqing
* Yamabuki
* Grid Black
* Rose Purple
* Ningye Purple
* Tech Blue
* Qingbi Liujin
* Qinghe Zhusha
* Cute Green
* Fullstack Blue
* Minimal Black
* Orange Blue
* Frontend Peak
* Cupid Busy

EasyMDE also provides code theme options including GitHub, GitHub Dark, Atom One Dark, Atom One Light, Monokai, VS2015, Xcode, and a WeChat-inspired style.

== Custom CSS ==

Authors can save custom CSS styles with a name and reuse them on later posts.

When a post uses custom CSS, EasyMDE stores a sanitized CSS snapshot with the post so published content can retain its appearance if the original saved style is later changed or removed.

Custom CSS is scoped to EasyMDE-rendered content. Remote CSS imports and external `url(...)` values are removed to keep the plugin self-contained by default.

== WeChat Copy ==

EasyMDE includes a **Copy to WeChat** action that copies the current preview as rich text.

The plugin clones the rendered preview and inlines important computed styles for typography, code blocks, tables, and images before copying. When supported by the browser, the copied content can be pasted directly into the WeChat Official Accounts editor.

If rich-text clipboard access is unavailable, EasyMDE uses available fallback methods or shows a clear error message without affecting article content.

== External Services ==

EasyMDE's JavaScript, CSS, fonts, icons, and rendering libraries remain bundled locally. Article images use an external object-storage service only after an administrator explicitly selects, configures, and saves an Image Hosting provider. That administrator action authorizes the requests described below. The browser sends files only to EasyMDE's protected same-origin REST route; provider credentials remain on the WordPress server and are never sent to the browser.

Cloudflare R2 is contacted only when it is the saved primary or enabled backup and an authorized author pastes or drops an accepted local image, or when an administrator explicitly tests that saved connection. For an upload, WordPress sends the image bytes, verified MIME type, generated object key, and minimum signed request metadata to the configured official R2 S3 API endpoint. A connection test sends a signed bucket request without image bytes or article content. Documentation: https://developers.cloudflare.com/r2/ . Terms: https://www.cloudflare.com/terms/ . Privacy policy: https://www.cloudflare.com/privacypolicy/ .

Qiniu Kodo is contacted only when it is the saved primary or enabled backup and an authorized author pastes or drops an accepted local image, or when an administrator explicitly tests that saved connection. For an upload, WordPress sends the image bytes, verified MIME type, generated object key, and minimum signed request metadata to Qiniu's official Kodo upload API. A connection test sends a signed bucket-list request without image bytes or article content. Documentation: https://developer.qiniu.com/kodo . Terms: https://www.qiniu.com/user-agreement . Privacy policy: https://www.qiniu.com/agreements/privacy-right .

Alibaba Cloud OSS is contacted only when it is the saved primary or enabled backup and an authorized author pastes or drops an accepted local image, or when an administrator explicitly tests that saved connection. For an upload, WordPress sends the image bytes, verified MIME type, generated object key, and minimum signed request metadata to the official OSS API host derived from the saved region and bucket. A connection test sends a signed bucket-information request without image bytes or article content. Documentation: https://www.alibabacloud.com/help/en/oss . Terms: https://www.alibabacloud.com/help/en/legal/latest/alibaba-cloud-product-terms-of-service . Privacy policy: https://www.alibabacloud.com/help/en/legal/latest/kcpor .

Tencent Cloud COS is contacted only when it is the saved primary or enabled backup and an authorized author pastes or drops an accepted local image, or when an administrator explicitly tests that saved connection. For an upload, WordPress sends the image bytes, verified MIME type, generated object key, and minimum signed request metadata to the official COS API host derived from the saved region and bucket. A connection test sends a signed bucket request without image bytes or article content. Documentation: https://www.tencentcloud.com/document/product/436 . Terms: https://www.tencentcloud.com/document/product/301/9248 . Privacy policy: https://www.tencentcloud.com/document/product/301/17345 .

Any supported provider may be primary or the optional same-object-key backup. Provider API endpoints or regions are separate from administrator-configured public delivery and optional fallback domains. A fallback domain only adds an explicit same-key `fallbackUrl` to a successful result; it does not perform another upload or silently replace the primary URL. A primary and backup that identify the same physical destination are rejected. Requests are not retried automatically, providers are not silently substituted, and paste and drag-and-drop never fall back to the WordPress media library. The toolbar media button remains the separate WordPress-native workflow.

== Installation ==

1. Upload the EasyMDE plugin folder to the `/wp-content/plugins/` directory, or install the plugin ZIP from **Plugins > Add New > Upload Plugin**.
2. Activate EasyMDE from the **Plugins** screen in WordPress.
3. Open or create content from the normal **Posts** and **Pages** screens.
4. Supported posts and pages open in EasyMDE. Legacy EasyMDE Markdown posts read stored Markdown metadata, while ordinary existing posts use an in-memory Markdown import of current post content until first save.

== Frequently Asked Questions ==

= Does EasyMDE require Jetpack or Classic Editor? =

No. EasyMDE is a standalone WordPress plugin and does not require Jetpack, Classic Editor, or another Markdown plugin.

= Does EasyMDE replace Gutenberg for every post? =

No. EasyMDE opens post types explicitly supported by the plugin, `post` and `page` by default. Unsupported post types keep their normal WordPress editor. Existing ordinary supported posts are not converted automatically on open; the first valid EasyMDE save stores Markdown state and rendered compatibility HTML.

= Does EasyMDE use external CDN assets? =

No plugin runtime assets are loaded from an external CDN. Mermaid, KaTeX, Highlight.js, and other plugin assets are bundled locally. Article images may separately use the administrator-configured object-storage service described under **External Services**.

= Does EasyMDE include translations? =

EasyMDE uses the standard WordPress text domain `easymde`. GitHub Release ZIPs include the bundled Simplified Chinese files `languages/easymde.pot`, `languages/easymde-zh_CN.po`, and `languages/easymde-zh_CN.mo`.

= Can I use Mermaid diagrams? =

Yes. EasyMDE supports local Mermaid rendering in the preview and frontend output.

= Can I write mathematical formulas? =

Yes. EasyMDE supports KaTeX math rendering for inline and block formulas.

= Can I add a table of contents? =

Yes. Add `[TOC]` or `[toc]` on its own line in the Markdown source.

= Can I insert WordPress media? =

Yes. Use the media button in the EasyMDE toolbar to insert an image from the WordPress media library. This native media picker is a separate explicit entry point from image paste and drag-and-drop.

= Does EasyMDE send images to an external service? =

Yes, but only after an administrator explicitly configures a provider and an authorized author pastes or drops an accepted local image, or when the administrator tests the saved connection. See **External Services** for the exact trigger, transmitted fields, provider links, terms, privacy policies, and failure behavior.

= Can I copy an article into the WeChat Official Accounts editor? =

Yes. Use the **Copy to WeChat** action in the editor. EasyMDE copies the current rendered preview as rich text when browser clipboard support is available.

= What happens if I deactivate EasyMDE? =

Published posts retain their rendered WordPress HTML. EasyMDE Markdown source and appearance settings remain stored with the post and can be used again after the plugin is reactivated.

= Where can I find security, upgrade, and bundled dependency information? =

See `SECURITY.md`, `UPGRADING.md`, and `THIRD-PARTY-NOTICES.md` in the release package.

== Changelog ==

= 0.1.8 =

* Deliver the ordinary editor as one React 18, strict TypeScript, and Vite Root while preserving the historical toolbar and fixed source/preview workspace.
* Keep synchronized title editing, CodeMirror, Preview enhancements, themes, fonts, local drafts, media, clipboard, and WeChat export in focused React components.
* Keep publishing, categories, tags, excerpts, featured media, and revisions on WordPress-native screens and Meta Boxes without duplicate React dialogs.
* Remove Outline, writing statistics, view-mode switching, draggable resizing, React publishing/revision dialogs, and all Focus Mode assets from the ordinary runtime.
* Remove the editor-surface dark mode without changing article themes, code themes, custom CSS, or frontend rendering.

= 0.1.7 =

* Replace large text toolbar controls with a compact icon toolbar and appearance popover.
* Add Typora-inspired shortcut defaults with site-wide Windows/Linux and macOS overrides.
* Add rich-text Copy to WeChat export from the editor preview.
* Add the Tech Blue article theme with themed typography, headings, inline code, lists, images, and Mac-style code framing.
* Add the Qingbi Liujin article theme with themed typography, headings, blockquotes, tables, code blocks, images, and footnotes.
* Add the EasyMDE-owned Qinghe Zhusha article theme, recreated from local Typora visual evidence with green/cinnabar accents, table scrolling, image captions, and Helvetica-based typography.
* Add temporary immersive writing mode.
* Add per-post font stack selection.

= 0.1.6 =

* Add a broader built-in article theme set as local scoped CSS recreations.
* Extend theme markup processing for built-in theme heading and link styles.

= 0.1.5 =

* Add Fullstack Blue, Yamabuki, and Orange Heart article themes.
* Make Atom One Dark with Mac-style framing the default code presentation.
* Refine built-in article theme styling.

= 0.1.4 =

* Add per-post article themes and code theme switching.
* Add Mac-style code frames.
* Add named reusable custom CSS styles.

= 0.1.3 =

* Improve editor pane scrolling inside the writing workspace.

= 0.1.2 =

* Refine editor height and preview spacing.

= 0.1.1 =

* Add local code highlighting, Mermaid, KaTeX, table of contents support, dark mode, and browser draft recovery.

= 0.1.0 =

* Initial release.
