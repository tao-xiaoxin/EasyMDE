=== EasyMDE ===
Contributors: tao-xiaoxin
Tags: markdown, editor, writing, preview, wechat
Requires at least: 6.0
Tested up to: 7.0
Requires PHP: 7.4
Stable tag: 0.1.7
License: Apache-2.0
License URI: https://www.apache.org/licenses/LICENSE-2.0

A standalone WordPress Markdown editor with split-pane live preview, local rendering tools, themes, and WeChat rich-text export.

== Description ==

EasyMDE opens new WordPress posts and pages in a Markdown editing surface by default. Existing ordinary posts and pages that have never used EasyMDE continue to use Gutenberg when edited.

Write Markdown on the left and review a live preview on the right. EasyMDE provides commonly used writing tools, media insertion, local rendering support, article themes, code highlighting, and rich-text export for the WeChat Official Accounts editor.

EasyMDE is self-contained and does not require Jetpack, Classic Editor, another Markdown plugin, or external CDN assets.

== Features ==

* Split-pane Markdown source editing and live preview.
* Scroll synchronization between source and preview panes.
* Compact icon toolbar for common Markdown formatting actions.
* Heading, appearance, and output controls in compact popovers.
* Typora-inspired keyboard shortcuts with configurable Windows/Linux and macOS bindings.
* WordPress media library insertion.
* REST-powered server preview.
* Browser local draft autosave and recovery.
* Temporary immersive writing mode for a larger editing workspace.
* Dark mode for the editor surface.
* Local Highlight.js code highlighting.
* Local Mermaid diagram rendering.
* Local KaTeX math rendering.
* `[TOC]` and `[toc]` table of contents generation.
* Per-post article themes and code themes.
* Optional Mac-style code block framing.
* Per-post article font stack selection.
* Named reusable custom CSS styles.
* Rich-text “Copy to WeChat” export from the rendered preview.
* Markdown source stored in post meta and rendered HTML stored in post content.
* No activation redirect and no unrelated admin-page redirect.

== Themes and Appearance ==

EasyMDE includes multiple built-in article themes inspired by Markdown2Html and mdnice-style layouts. Themes are implemented locally with scoped CSS and do not load remote decorative assets.

Article theme, code theme, Mac-style code frame, font stack, and custom CSS choices are saved per post. The current user's latest appearance choices are reused as defaults for future posts.

The editor includes article themes such as:

* Default
* Orange Heart
* Chazi Purple
* Nenqing Green
* Green Vitality
* Red Crimson
* Blue Ying
* Lanqing
* Yamabuki
* Grid Black
* Geek Black
* Rose Purple
* Ningye Purple
* Tech Blue
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

== Installation ==

1. Upload the EasyMDE plugin folder to the `/wp-content/plugins/` directory, or install the plugin ZIP from **Plugins > Add New > Upload Plugin**.
2. Activate EasyMDE from the **Plugins** screen in WordPress.
3. Create Markdown content from **Posts > Add New** or **Pages > Add New**.
4. Edit legacy EasyMDE Markdown posts normally; they reopen in EasyMDE when their stored Markdown metadata exists.

Existing posts and pages without EasyMDE metadata keep the normal WordPress editor when edited.

== Frequently Asked Questions ==

= Does EasyMDE require Jetpack or Classic Editor? =

No. EasyMDE is a standalone WordPress plugin and does not require Jetpack, Classic Editor, or another Markdown plugin.

= Does EasyMDE replace Gutenberg for every post? =

No. New posts and pages open in EasyMDE by default, but existing ordinary Gutenberg posts are not converted automatically. Existing posts and pages without EasyMDE metadata continue to use Gutenberg when edited.

= Does EasyMDE use external CDN assets? =

No. Mermaid, KaTeX, Highlight.js, and plugin assets are bundled locally.

= Does EasyMDE include translations? =

EasyMDE uses the standard WordPress text domain `easymde`. GitHub Release ZIPs include the bundled Simplified Chinese files `languages/easymde.pot`, `languages/easymde-zh_CN.po`, and `languages/easymde-zh_CN.mo`.

= Can I use Mermaid diagrams? =

Yes. EasyMDE supports local Mermaid rendering in the preview and frontend output.

= Can I write mathematical formulas? =

Yes. EasyMDE supports KaTeX math rendering for inline and block formulas.

= Can I add a table of contents? =

Yes. Add `[TOC]` or `[toc]` on its own line in the Markdown source.

= Can I insert WordPress media? =

Yes. Use the media button in the EasyMDE toolbar to insert an image from the WordPress media library.

= Can I copy an article into the WeChat Official Accounts editor? =

Yes. Use the **Copy to WeChat** action in the editor. EasyMDE copies the current rendered preview as rich text when browser clipboard support is available.

= What happens if I deactivate EasyMDE? =

Published posts retain their rendered WordPress HTML. EasyMDE Markdown source and appearance settings remain stored with the post and can be used again after the plugin is reactivated.

= Where can I find security, upgrade, and bundled dependency information? =

See `SECURITY.md`, `UPGRADING.md`, and `THIRD-PARTY-NOTICES.md` in the release package.

== Changelog ==

= 0.1.7 =

* Replace large text toolbar controls with a compact icon toolbar and appearance popover.
* Add Typora-inspired shortcut defaults with site-wide Windows/Linux and macOS overrides.
* Add rich-text Copy to WeChat export from the editor preview.
* Add the Tech Blue article theme with themed typography, headings, inline code, lists, images, and Mac-style code framing.
* Add the Qinghe Zhusha article theme with Typora-derived green/cinnabar accents, table scrolling, image captions, and Helvetica-based typography.
* Add temporary immersive writing mode.
* Add per-post font stack selection.

= 0.1.6 =

* Add the full Markdown2Html-style article theme set as local scoped CSS recreations.
* Extend theme markup processing for built-in theme heading and link styles.

= 0.1.5 =

* Add Fullstack Blue, Yamabuki, and Orange Heart article themes.
* Make Atom One Dark with Mac-style framing the default code presentation.
* Refine built-in article theme styling.

= 0.1.4 =

* Add per-post article themes and code theme switching.
* Add optional Mac-style code frames.
* Add named reusable custom CSS styles.

= 0.1.3 =

* Improve editor pane scrolling inside the writing workspace.

= 0.1.2 =

* Refine editor height and preview spacing.

= 0.1.1 =

* Add local code highlighting, Mermaid, KaTeX, table of contents support, dark mode, and browser draft recovery.

= 0.1.0 =

* Initial release.
