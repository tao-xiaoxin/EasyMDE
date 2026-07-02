=== EasyMDE ===
Contributors: tao-xiaoxin
Tags: markdown, editor, writing, preview, posts
Requires at least: 6.0
Tested up to: 6.9
Requires PHP: 7.4
Stable tag: 0.1.7
License: Apache-2.0
License URI: https://www.apache.org/licenses/LICENSE-2.0

A standalone WordPress Markdown editor with split-pane live preview.

== Description ==

EasyMDE replaces the default post/page authoring surface with a scoped Markdown editor: source on the left, live preview on the right, and toolbar actions for common writing tasks.

The plugin is designed to be self-contained. It does not require Jetpack, Classic Editor, or another Markdown plugin.

== Current Features ==

* Scoped post/page editor integration.
* Split-pane Markdown source and preview.
* Scroll synchronization.
* Compact icon toolbar for common Markdown actions.
* Typora-inspired keyboard shortcuts with plugin settings overrides.
* WordPress media insertion.
* REST-powered server preview.
* Browser local draft autosave.
* Right-side "Copy to WeChat" rich-text export action.
* Dark mode toggle.
* Temporary immersive writing mode.
* Local code highlighting.
* Per-post Markdown theme selection with the full Markdown2Html-style article theme set.
* Per-post code theme selection.
* Named per-user custom CSS styles for reuse on future posts.
* Local Mermaid rendering.
* Local KaTeX rendering.
* [TOC] table of contents generation.
* Markdown source stored in post meta.
* Rendered HTML saved into post content.
* No activation redirect.
* No unrelated admin-page redirect.

== Themes and Custom CSS ==

Article theme, code theme, Mac-style code frame, and font choices are saved per
post. The current user's most recent choices are reused as defaults for new
posts. The editor surface keeps these controls inside compact popovers so the
toolbar can stay icon-focused.

The toolbar includes an immersive writing toggle. It temporarily expands the
EasyMDE editor over the WordPress edit screen so the Markdown source and live
preview can use the full viewport. The mode is session-only: refreshing or
opening another post returns to the normal WordPress editor layout.

EasyMDE uses Typora-inspired shortcut defaults for formatting, headings, lists,
code, links, images, saving, and WeChat copy. Administrators can override the
Windows/Linux and macOS bindings independently from the plugin settings page.
The built-in default code presentation is atom-one-dark with the CSS-only
Mac-style frame enabled.

Authors can save custom CSS with a name, then choose it again on later posts.
When a post uses custom CSS, EasyMDE stores a sanitized snapshot with the post so
the published article keeps its appearance if the saved style is later changed or
deleted.

Custom CSS is scoped to EasyMDE-rendered content. Remote CSS imports and url()
values are stripped to keep local assets as the default behavior.

The font popover builds an mdnice-compatible fallback stack from custom Latin
fonts, Windows fonts, Apple fonts, and a serif/sans-serif final fallback. System
font names are tried when the visitor's device has them installed. The selected
stack affects rendered article text in preview and on the frontend while code
remains monospace.

Built-in article themes include the Markdown2Html-style set: default,
orange-heart, chazi-purple, nenqing-green, green-vitality, red-crimson,
blue-ying, lanqing, yamabuki, grid-black, geek-black, rose-purple,
ningye-purple, tech-blue, cute-green, fullstack-blue, minimal-black,
orange-blue, and frontend-peak. They style
colors, headings, typography, blockquotes, inline code, lists, tables, images,
table of contents, and math blocks through scoped CSS.

These themes are local CSS recreations based on Markdown2Html visual references.
The plugin does not copy GPL-licensed Markdown2Html source files or load remote
decorative theme images.

== WeChat Copy ==

The editor includes a right-side "Copy to WeChat" action that copies the
current preview as rich text. EasyMDE clones the rendered preview and inlines
the key computed styles for typography, code, tables, and images before writing
clipboard data when the browser allows it.

If the browser does not expose rich-text clipboard APIs, EasyMDE falls back to
older copy mechanisms when available and otherwise shows a clear non-destructive
error message instead of silently failing.

== Installation ==

1. Upload the plugin directory to `/wp-content/plugins/easymde`.
2. Activate EasyMDE from the WordPress Plugins screen.
3. Edit a post or page.

== Changelog ==

= 0.1.7 =
* Replace large text toolbar controls with a compact icon toolbar and appearance popover.
* Add Typora-inspired shortcut defaults with site-wide settings for Windows/Linux and macOS overrides.
* Add a right-side "Copy to WeChat" rich-text export action for the editor preview.
* Add the mdnice tech-blue article theme with source-verified typography, headings, inline code, lists, images, and Mac-style code framing.

= 0.1.6 =
* Add the full Markdown2Html-style article theme set as local scoped CSS recreations.
* Extend theme markup processing so headings and links support the full built-in theme set.

= 0.1.5 =
* Add fullstack-blue, yamabuki, and orange-heart article themes inspired by mdnice rendered examples.
* Make atom-one-dark with Mac-style framing the default code presentation.
* Tune rose-purple colors to match mdnice reference values more closely.
* Keep dark code backgrounds visible before highlight.js enhancement.

= 0.1.4 =
* Add per-post Markdown themes, code theme switching, Mac-style code frames, and named reusable custom CSS.

= 0.1.3 =
* Keep editor panes scrollable inside the larger editor workspace.

= 0.1.2 =
* Refine editor height and preview spacing.

= 0.1.1 =
* Add local code highlighting, Mermaid, KaTeX, TOC, dark mode, and browser drafts.

= 0.1.0 =
* Initial MVP.
