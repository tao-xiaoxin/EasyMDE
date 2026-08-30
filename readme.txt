=== EasyMDE ===
Contributors: tao-xiaoxin
Tags: markdown, editor, writing, preview, wechat
Requires at least: 6.7
Tested up to: 7.1
Requires PHP: 7.4
Stable tag: 0.1.8
License: Apache-2.0
License URI: https://www.apache.org/licenses/LICENSE-2.0

A WordPress Markdown editor for writers, with split-pane live preview, themes, diagrams, math, and WeChat rich-text export.

== Description ==

EasyMDE gives WordPress writers, technical bloggers, and WeChat content creators a focused Markdown workspace in the normal WordPress editor. It works with Posts, Pages, and other post types supported by the site.

Write Markdown on the left and review a live preview on the right. Use familiar WordPress tools to manage media, categories, tags, excerpts, featured images, revisions, and publishing while you work.

EasyMDE adds article themes, code highlighting, diagrams, mathematical formulas, and rich-text copy to the WeChat Official Accounts editor. It does not require Jetpack, Classic Editor, or another Markdown plugin.

== Features ==

= Focused writing =

* Work in a split-pane Markdown editor and live preview with synchronized scrolling.
* Use a compact icon toolbar for common Markdown actions.
* Use Typora-inspired keyboard shortcuts with site-wide Windows/Linux and macOS settings.
* Insert media directly from the WordPress Media Library.
* Recover browser-local drafts with clear restore, discard, and cross-tab choices.
* Write beside the live preview on desktop; the panes stack vertically on narrow screens.

= Rich content =

* Write with headings, lists, links, images, tables, task lists, and code blocks.
* Add code syntax highlighting, Mermaid diagrams, KaTeX formulas, and `[TOC]` or `[toc]` tables of contents.
* Paste or drag local images into an article with optional Image Hosting.
* Configure Image Hosting with Cloudflare R2, Qiniu Kodo, Alibaba Cloud OSS, or Tencent Cloud COS.

= Personal appearance =

* Choose an article theme, code theme, and font stack for each post.
* Use the selected appearance on published content, or keep it in editor Preview only.
* Show published code-block copy buttons by default; hide them when you prefer while keeping code rendering and syntax highlighting.
* Save named custom CSS styles in your own library and reuse them when needed.

= WordPress integration =

* Write from the normal WordPress Posts, Pages, and other supported post-type screens.
* Continue using WordPress's native publishing, categories, tags, excerpts, featured images, revisions, and permissions.
* EasyMDE does not replace the normal WordPress tools you use to manage an article.

= Publishing and sharing =

* Publish formatted Markdown articles through WordPress.
* Copy the current preview as rich text into the WeChat Official Accounts editor.

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

Authors with the WordPress `unfiltered_html` capability can save named custom CSS styles in their own library and reuse them on later posts.

When a post uses custom CSS, EasyMDE stores a sanitized CSS snapshot with the post so published content can retain its appearance if the original saved style is later changed or removed.

Custom CSS is scoped to EasyMDE-rendered content. Remote CSS imports and external `url(...)` values are removed to keep the plugin self-contained by default.

== WeChat Copy ==

EasyMDE includes a **Copy to WeChat** action that copies the current preview as rich text.

The plugin clones the rendered preview and inlines important computed styles for typography, code blocks, tables, and images before copying. When supported by the browser, the copied content can be pasted directly into the WeChat Official Accounts editor.

If rich-text clipboard access is unavailable, EasyMDE uses available fallback methods or shows a clear error message without affecting article content.

== External Services ==

EasyMDE's JavaScript, CSS, fonts, icons, and rendering libraries remain bundled locally. External object storage is contacted only for an authorized article upload using a saved Image Hosting configuration, or when an administrator explicitly invokes Verify Upload for the current Image Hosting form. Those explicit actions authorize the requests described below. The browser sends files and verification drafts only to EasyMDE's protected same-origin REST routes. Ordinary settings reads, bootstrap data, exports, and logs keep provider credentials redacted. An administrator may explicitly reveal one saved Access Key or Secret Key through its eye control; that dedicated `manage_options`-protected POST requires both the WordPress REST Nonce and an action-specific Nonce, is returned with `Cache-Control: no-store`, and remains only in the current page's memory.

Cloudflare R2 is contacted only when it is the saved primary or enabled backup and an authorized author pastes or drops an accepted local image, or when an administrator explicitly invokes Verify Upload for the current Image Hosting form. WordPress sends the image bytes, verified MIME type, generated object key, and minimum signed request metadata to the configured official R2 S3 API endpoint. Verify Upload sends the bundled EasyMDE PNG bytes with `image/png` to an object key generated by the current file-name rule; it does not send article content. Newly entered credentials travel only through the protected same-origin request to WordPress; saved credentials may be reused only when the settings revision and physical destination still match. Documentation: https://developers.cloudflare.com/r2/ . Terms: https://www.cloudflare.com/terms/ . Privacy policy: https://www.cloudflare.com/privacypolicy/ .

Qiniu Kodo is contacted only when it is the saved primary or enabled backup and an authorized author pastes or drops an accepted local image, or when an administrator explicitly invokes Verify Upload for the current Image Hosting form. WordPress sends the image bytes, verified MIME type, generated object key, and minimum signed request metadata to Qiniu's official Kodo upload API. Verify Upload sends the bundled EasyMDE PNG bytes with `image/png` to an object key generated by the current file-name rule; it does not send article content. Newly entered credentials travel only through the protected same-origin request to WordPress; saved credentials may be reused only when the settings revision and physical destination still match. Documentation: https://developer.qiniu.com/kodo . Terms: https://www.qiniu.com/user-agreement . Privacy policy: https://www.qiniu.com/agreements/privacy-right .

Alibaba Cloud OSS is contacted only when it is the saved primary or enabled backup and an authorized author pastes or drops an accepted local image, or when an administrator explicitly invokes Verify Upload for the current Image Hosting form. WordPress sends the image bytes, verified MIME type, generated object key, and minimum signed request metadata to the selected official OSS API endpoint and bucket. The signing region is derived from that endpoint. Verify Upload sends the bundled EasyMDE PNG bytes with `image/png` to an object key generated by the current file-name rule; it does not send article content. Newly entered credentials travel only through the protected same-origin request to WordPress; saved credentials may be reused only when the settings revision and physical destination still match. Documentation: https://www.alibabacloud.com/help/en/oss . Terms: https://www.alibabacloud.com/help/en/legal/latest/alibaba-cloud-product-terms-of-service . Privacy policy: https://www.alibabacloud.com/help/en/legal/latest/kcpor .

Tencent Cloud COS is contacted only when it is the saved primary or enabled backup and an authorized author pastes or drops an accepted local image, or when an administrator explicitly invokes Verify Upload for the current Image Hosting form. WordPress sends the image bytes, verified MIME type, generated object key, and minimum signed request metadata to the selected official COS API endpoint and bucket. The signing region is derived from that endpoint. Verify Upload sends the bundled EasyMDE PNG bytes with `image/png` to an object key generated by the current file-name rule; it does not send article content. Newly entered credentials travel only through the protected same-origin request to WordPress; saved credentials may be reused only when the settings revision and physical destination still match. Documentation: https://www.tencentcloud.com/document/product/436 . Terms: https://www.tencentcloud.com/document/product/301/9248 . Privacy policy: https://www.tencentcloud.com/document/product/301/17345 .

Any supported provider may be primary or the optional backup. Provider Endpoints are HTTPS upload API origins. The separately configured primary Viewing Image Domain accepts HTTP or HTTPS and is the public URL base that produces the one authoritative URL only after every required write succeeds. An HTTP image URL may be blocked as mixed content on an HTTPS article page; that display restriction does not make the upload fail. Primary and backup always use the same generated object key, and configurations that identify the same physical destination are rejected. The one saved Upload Retry Count appears with the primary settings, accepts 0 through 5, and defaults to 0; N means at most N extra serial attempts after a destination's first failed write and applies to both primary and enabled backup writes. Every attempt sends the same image bytes to the same provider and object key and stops after the first success. Repeated requests may overwrite that same object and may incur provider request charges. If the primary exhausts its attempts, or an enabled backup exhausts its attempts, EasyMDE fails the whole article upload, returns no image URL, inserts nothing, and displays a redacted accessible error asking the user to retry manually. A provider object may remain after failure because there is no reliable cross-provider compensating delete. Verify Upload remains single-attempt, providers are not silently substituted, and paste and drag-and-drop never fall back to the WordPress media library. Verify Upload targets only the selected provider, uses the current file-name rule, leaves or overwrites its resulting object under the administrator's provider retention policy, and displays a structured result with the authoritative object path and article URL. Rules containing time or UUID variables may create a new object on each verification. The `{md5}` filename variable is the lowercase hexadecimal MD5 digest of the final bytes sent to the provider after any enabled processing, matching PicFast PicGo's content-MD5 algorithm; EasyMDE derives the extension from the verified MIME type. The toolbar media button remains the separate WordPress-native workflow.

== Installation ==

1. Download `EasyMDE.zip` from the [GitHub Release](https://github.com/tao-xiaoxin/EasyMDE/releases/latest).
2. In WordPress, go to **Plugins > Add New > Upload Plugin**, upload `EasyMDE.zip`, and activate it.
3. Open or create a Post, Page, or other supported content type in the normal WordPress editor and start writing in Markdown.

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

Yes, but only after an administrator explicitly configures a provider and an authorized author pastes or drops an accepted local image, or when the administrator invokes Verify Upload for the current Image Hosting form. Verify Upload sends the bundled EasyMDE PNG using the current file-name rule and displays its path and URL. See **External Services** for the exact trigger, transmitted fields, provider links, terms, privacy policies, and failure behavior.

= Can I copy an article into the WeChat Official Accounts editor? =

Yes. Use the **Copy to WeChat** action in the editor. EasyMDE copies the current rendered preview as rich text when browser clipboard support is available.

= What happens if I deactivate EasyMDE? =

Published posts retain their rendered WordPress HTML. EasyMDE Markdown source and appearance settings remain stored with the post and can be used again after the plugin is reactivated.

= Where can I find security, upgrade, and bundled dependency information? =

See `SECURITY.md`, `UPGRADING.md`, and `THIRD-PARTY-NOTICES.md` in the release package.

== Changelog ==

= 0.1.8 =

* Rebuild the ordinary WordPress editor as a single React 18 root using strict TypeScript and Vite, while retaining the split source/preview workspace, toolbar, drafts, media, preview, themes, fonts, and WeChat export.
* Add immersive writing with visual Markdown editing and a focused workspace, while keeping publishing, autosave, media, revisions, and other document authority on WordPress-native paths.
* Add a React Settings Center for editor defaults, Markdown behavior, keyboard shortcuts, and image-hosting configuration, with saved settings applied through the existing WordPress settings boundary.
* Add explicitly triggered uploads to Cloudflare R2, Qiniu Kodo, Alibaba Cloud OSS, and Tencent Cloud COS, with optional backup destinations and bounded retries; exhausted destinations fail visibly without silent provider switching, WordPress Media fallback, or URL insertion.
* Move Preview enhancements, WeChat rich-text export, and public code-copy runtime assets to local TypeScript/Vite bundles, keeping rendering and browser integrations self-contained without runtime CDNs.
* Expand and unify appearance with Crimson Focus, Inkwell, Animal Island, Phycat, Mdmdt, Dog's Choice, Bloom, and Spring article theme families, plus Terminal Noir and associated Typora-derived code palettes.
* Improve per-post and user-default font stacks and named custom CSS, preserving sanitized CSS snapshots and each article theme's code-theme defaults.
* Keep Markdown and rendered HTML under the WordPress persistence boundary: ordinary supported posts are not written or migrated on open, and EasyMDE state is established on the next legitimate save.
* Simplify the ordinary editor by removing Outline, writing statistics, view-mode switching, draggable resizing, duplicate React publishing/revision dialogs, and editor-surface dark mode without changing article themes, code themes, custom CSS, or frontend rendering.

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
