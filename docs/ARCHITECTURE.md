# EasyMDE Architecture

EasyMDE is wired from `easymde.php` into `EasyMDE\Plugin`. The global
`EasyMDE_Plugin` class remains as a compatibility facade only.

## Directories

- `src/Admin/`: editor screen, per-post editor mode, admin settings, admin assets, and save handling.
- `src/Content/`: Markdown rendering, TOC generation, theme markup transforms, post document state, and revision restore coordination.
- `src/Theme/`: article/code theme registries, theme state, and custom CSS policy.
- `src/Rest/`: `easymde/v1` REST controllers.
- `src/Frontend/`: frontend content filtering and asset loading.
- `src/Support/`: shared helpers, capabilities, option access, lazy migration helpers, legacy facade APIs, and the temporary zh_CN gettext shim.
- `templates/admin/`: admin templates that render prepared data.
- `assets/themes/article/`: EasyMDE-owned article themes.
- `assets/themes/code/`: EasyMDE-owned code themes.
- `assets/vendor/`: third-party assets such as Highlight.js, KaTeX, and Mermaid.
- `scripts/`: local asset copy and release package assembly scripts.
- `tests/Unit/` and `tests/Integration/`: real WordPress PHPUnit coverage for rendering, REST permissions, revisions, migration, editor gating, and compatibility facade behavior.
- `tests/e2e/`: Chromium Playwright coverage for author workflows against an installed release ZIP.

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

Markdown is rendered with raw HTML stripped and unsafe links disabled.
`TocGenerator` owns heading IDs and `[TOC]` replacement.
`ThemeMarkupTransformer` owns article-theme-specific DOM transforms and MDNice
container normalization. Math placeholders remain in `MarkdownRenderer`.

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

The admin editor assets are also split by responsibility. `toolbar.css` and
`popover.css` hold toolbar/control presentation while `editor.css` holds the
workspace, preview, dark-mode, and responsive layout layer. Admin JavaScript is
loaded as classic WordPress scripts: state helpers, command primitives, preview
client helpers, theme manager helpers, toolbar helpers, draft storage, media
picker, WeChat exporter, and bootstrap.

`npm run build:release` assembles `dist/easymde` and `dist/easymde.zip` from
runtime files. It refuses to run if Composer dependencies, local vendor assets,
registered theme assets, translation files, or version metadata are missing or
inconsistent. Release packaging also requires `composer install --no-dev`; if
Composer development packages are installed, the build fails instead of copying a
vendor tree with development autoload metadata.

`scripts/run-plugin-check.sh` installs the built ZIP into a clean WordPress site,
activates it, runs the official Plugin Check plugin, and fails on Plugin Check
errors. Reviewed Plugin Check warnings and their release-policy rationale are
tracked in `docs/PLUGIN_CHECK.md`.

## REST Boundaries

All EasyMDE REST routes use namespace `easymde/v1`.

Preview and theme requests with `post_id` require
`current_user_can( 'edit_post', $post_id )`. Preview without a `post_id` requires
`edit_posts`. Custom CSS endpoints only read and write the current user's user
meta; full CSS create/update/delete requires `unfiltered_html`.

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

## Internationalization

EasyMDE uses the standard WordPress text domain `easymde` and loads bundled
language files from `languages/` during the normal plugin initialization flow.
The GitHub Release ZIP includes `languages/easymde.pot`,
`languages/easymde-zh_CN.po`, and `languages/easymde-zh_CN.mo`.

PHP remains the translation source for browser UI text. Admin JavaScript reads
author-facing strings from `EasyMDEConfig.strings`, and frontend enhancement
scripts read visitor-facing strings from `EasyMDEFrontendConfig.strings`.

Translation maintenance uses gettext tooling:

```bash
npm run i18n:make-pot
npm run i18n:compile
npm run i18n:check
```

Third-party runtime notices are generated and checked separately with
`npm run notices:write` and `npm run notices:check`.

The repository does not use a runtime gettext filter, locale-specific PHP
translation array, WordPress.org translation-platform integration, or remote CDN
language assets.
