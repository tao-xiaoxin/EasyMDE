# EasyMDE

EasyMDE is a full-featured WordPress Markdown editor plugin focused on a clean split-pane writing experience: Markdown source on the left, live preview on the right, and enough extension points to grow into a serious publishing tool.

The project name is EasyMDE, but the goal is broader than wrapping one editor library. The plugin should provide a self-contained WordPress Markdown workflow without depending on Jetpack, Classic Editor, or another Markdown plugin.

## Goals

- Provide a modern Markdown editor for WordPress posts and pages.
- Support split-pane live preview with scroll sync.
- Keep Markdown as the primary authoring format.
- Work as one standalone WordPress plugin.
- Store and render content predictably, without hijacking unrelated admin pages.
- Make toolbar buttons, renderers, upload handling, and shortcode helpers extensible.
- Keep assets local by default instead of relying on external CDNs.

## Non-Goals

- Do not depend on Jetpack Markdown.
- Do not require Classic Editor as a separate plugin.
- Do not globally replace or redirect unrelated WordPress admin pages.
- Do not convert every post into Gutenberg blocks as the primary workflow.
- Do not ship a large page-builder experience.

## Planned Architecture

```text
WordPress Plugin
├── PHP plugin bootstrap
├── Admin editor integration
├── Markdown storage and render pipeline
├── Frontend content rendering
├── Local editor assets
└── Extension APIs
```

Recommended foundation:

- Editor UI: TOAST UI Editor, or another modern editor that supports Markdown source editing, live preview, toolbar customization, and extension hooks.
- Server rendering: `league/commonmark` for predictable CommonMark/GFM-compatible output.
- Sanitization: WordPress escaping and allowlist APIs, such as `wp_kses_post`, with plugin-specific hardening where needed.

## Core Features

Initial target:

- Markdown source editor.
- Split-pane live preview.
- Scroll synchronization.
- Toolbar for common Markdown actions.
- WordPress media insertion.
- Autosave-friendly content handling.
- Markdown rendering on the frontend.
- Per-post Markdown metadata where needed.

Later features:

- Custom toolbar button registry.
- Shortcode helper buttons.
- Code block enhancements.
- Copy button for code blocks.
- Table helpers.
- Image upload and URL replacement helpers.
- Obsidian-style link helpers.
- Import path from WP Editor.md-style content.

## Extension Direction

The plugin should expose internal registration APIs instead of forcing every feature into the core editor:

```php
EasyMDE_Plugin::register_toolbar_button(...);
EasyMDE_Plugin::register_markdown_renderer(...);
EasyMDE_Plugin::register_shortcode_helper(...);
EasyMDE_Plugin::register_media_transform(...);
```

The exact API shape is not final. The important constraint is that new features should be added through stable hooks or registries, not by patching editor internals.

## Safety Principles

- Admin integration must be scoped to intended editor screens only.
- Plugin activation must not redirect every admin request to a settings page.
- Frontend rendering must sanitize generated HTML.
- External network assets should be avoided by default.
- Existing WordPress content should not be destructively rewritten.

## Status

This repository is in early MVP development.

Current implementation:

- Standalone WordPress plugin bootstrap.
- Scoped post/page editor integration.
- Block editor disabled only for supported post types.
- Split Markdown source and preview panes.
- Compact icon toolbar for common Markdown actions.
- Typora-inspired keyboard shortcuts with site-wide overrides.
- WordPress media insertion button.
- REST-powered server preview endpoint.
- Browser local draft autosave and restore prompt.
- Right-side "Copy to WeChat" rich-text export action.
- Dark mode toggle for the editor surface.
- Local highlight.js code highlighting.
- Per-post Markdown theme selection, including the full Markdown2Html-style article theme set.
- Per-post code theme selection with local highlight.js styles.
- Optional local CSS-only Mac-style code frame.
- Named per-user custom CSS styles that can be reused on new posts.
- Local Mermaid diagram rendering.
- Local KaTeX math rendering.
- `[TOC]` / `[toc]` table of contents generation.
- Markdown source stored in `_easymde_markdown`.
- Rendered HTML saved into `post_content`.
- Frontend content rendered from stored Markdown when available.
- Settings page for status plus shortcut configuration, with no activation redirect.

## Themes and Custom CSS

The editor uses a compact icon toolbar instead of large text buttons. Common
formatting actions stay in the top bar, headings move into a popover, and theme
controls live in an appearance panel so the writing surface keeps more room for
source and preview. Theme choices are still saved per post, and the most recent
choice is also saved as the current user's default for new posts.

EasyMDE ships with Typora-inspired shortcut defaults for formatting, headings,
lists, code, links, images, saving, and WeChat copy. Administrators can change
the Windows/Linux and macOS bindings independently from the plugin settings
screen.

The built-in default code presentation is `atom-one-dark` with the CSS-only
Mac-style frame enabled, so code blocks use the expected dark `#282c34`
background before and after highlight.js enhancement.

Custom CSS styles can be saved with a user-provided name. Saved styles are kept
in user meta and can be selected again on later posts. When a post uses a custom
style, EasyMDE stores a sanitized CSS snapshot with the post so published content
keeps the same appearance even if the user later edits or removes the library
entry.

Custom CSS is scoped to EasyMDE-rendered content and is sanitized before storage.
Remote CSS imports and `url(...)` values are stripped so the editor and frontend
do not depend on external assets by default.

The built-in article themes include the Markdown2Html-style set: default,
orange-heart, chazi-purple, nenqing-green, green-vitality, red-crimson,
blue-ying, lanqing, yamabuki, grid-black, geek-black, rose-purple, cute-green,
fullstack-blue, minimal-black, orange-blue, and frontend-peak. They style
colors, heading treatments, typography, blockquotes, inline code, lists, tables,
image presentation, table of contents, and math blocks through scoped CSS.

These themes are local CSS recreations based on Markdown2Html visual references.
The plugin does not copy GPL-licensed Markdown2Html source files or load remote
decorative theme images.

## WeChat Copy

The editor includes a right-side **Copy to WeChat** action that copies the
current preview as rich text. EasyMDE clones the rendered preview, inlines the
computed styles for core typography, code, tables, and images, then writes both
`text/html` and `text/plain` clipboard payloads when the browser allows it.

If the browser does not expose rich-text clipboard APIs, EasyMDE falls back to
older copy mechanisms when available and otherwise shows a non-destructive error
message instead of silently failing.

## Development

Install PHP dependencies when Composer is available:

```bash
composer install
```

Without Composer dependencies, the plugin falls back to a small internal renderer so the editor can still be tested. For production-grade Markdown/GFM rendering, use `league/commonmark`.

Install local frontend assets for highlighting, Mermaid, and KaTeX:

```bash
npm install
```

This copies runtime assets into `assets/vendor/`. Do not commit `node_modules`.
The copied highlight.js styles include `github`, `github-dark`,
`atom-one-dark`, `atom-one-light`, `monokai`, `vs2015`, and `xcode`; the
`wechat-inspired` style is maintained locally in this plugin.

To test in WordPress, copy or symlink this repository into:

```text
wp-content/plugins/easymde
```

Then activate **EasyMDE** in the WordPress plugins screen.

For local Docker testing:

```bash
cp .env.example .env
docker compose up -d
```

Open:

```text
http://localhost:8088
```

The Docker test site is initialized with WordPress `6.9` and Simplified Chinese
(`zh_CN`) by default, matching the minimum supported version for this project.
Set the local administrator and database passwords in `.env`; do not commit that
file.

Useful checks inside the Docker environment:

```bash
docker compose exec -T wordpress php -l wp-content/plugins/easymde/easymde.php
docker compose exec -T wordpress php -l wp-content/plugins/easymde/includes/class-easymde-plugin.php
```

When documenting test results, use placeholder values from `.env.example` and do
not record real local paths, passwords, database credentials, REST nonces,
cookies, or administrator secrets.

To reinstall the local test site from scratch:

```bash
docker compose down -v
docker compose up -d
```
