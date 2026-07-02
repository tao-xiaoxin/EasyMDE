# EasyMDE Architecture

EasyMDE is wired from `easymde.php` into `EasyMDE\Plugin`. The global
`EasyMDE_Plugin` class remains as a compatibility facade only.

## Directories

- `src/Admin/`: editor screen, per-post editor mode, admin settings, admin assets, and save handling.
- `src/Content/`: Markdown rendering, post document state, and revision restore coordination.
- `src/Theme/`: article/code theme registries, theme state, and custom CSS policy.
- `src/Rest/`: `easymde/v1` REST controllers.
- `src/Frontend/`: frontend content filtering and asset loading.
- `src/Support/`: shared helpers, capabilities, legacy facade APIs, and the temporary zh_CN gettext shim.
- `templates/admin/`: admin templates that render prepared data.
- `assets/themes/article/`: EasyMDE-owned article themes.
- `assets/themes/code/`: EasyMDE-owned code themes.
- `assets/vendor/`: third-party assets such as Highlight.js, KaTeX, and Mermaid.

## Data Model

Markdown is the source of truth in `_easymde_markdown`. WordPress
`post_content` stores rendered HTML for themes, feeds, and plugin
compatibility.

EasyMDE mode is per post:

- `_easymde_enabled = 1` means EasyMDE is enabled.
- If `_easymde_enabled` does not exist but `_easymde_markdown` exists, the post is treated as a legacy EasyMDE post.
- Posts without either meta key keep the normal WordPress editor.

Legacy detection uses `metadata_exists( 'post', $post_id, '_easymde_markdown' )`
so empty Markdown drafts are still recognized.

## Rendering

`EasyMDE\Content\MarkdownRenderer` is the only production renderer and requires
`league/commonmark`. If Composer dependencies are missing, EasyMDE shows an
admin notice, preview requests fail with a REST error, and save/frontend paths
avoid generating fallback HTML.

Markdown is rendered with raw HTML stripped and unsafe links disabled, then
post-processed for EasyMDE theme markup, math placeholders, and table of
contents support.

## Theme And Asset Boundaries

`ArticleThemeRegistry` and `CodeThemeRegistry` explicitly register available
themes. They do not scan directories at runtime.

Article themes are owned assets under `assets/themes/article/`. Highlight.js
vendor styles remain under `assets/vendor/highlight/styles/`. The owned
`wechat-inspired` code theme is stored under `assets/themes/code/`.

Frontend EasyMDE posts load:

- `assets/css/frontend/base.css`
- the selected article theme stylesheet
- code frame CSS only when highlighting or Mac framing is needed
- the selected code theme stylesheet only when code highlighting is needed
- KaTeX, Mermaid, and Highlight.js scripts only when the current Markdown needs them

## REST Boundaries

All EasyMDE REST routes use namespace `easymde/v1`.

Preview and theme requests with `post_id` require
`current_user_can( 'edit_post', $post_id )`. Preview without a `post_id` requires
`edit_posts`. Custom CSS endpoints only read and write the current user's user
meta; full CSS create/update requires `unfiltered_html`.

Preview Markdown payloads are capped at 1 MiB.

## Compatibility Facade

The public methods below remain available:

```php
EasyMDE_Plugin::register_toolbar_button();
EasyMDE_Plugin::register_shortcode_helper();
```

They delegate to `EasyMDE\Support\ToolbarRegistry`. Future extension APIs should
move toward namespaced services, but this release keeps existing extension code
working.

## Internationalization Shim

The existing Simplified Chinese gettext mapping was moved to
`EasyMDE\Support\LegacyTranslations`. It is a temporary compatibility shim; new
strings should move through normal translation files in a future i18n pass.
