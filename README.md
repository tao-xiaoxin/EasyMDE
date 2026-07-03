<p align="center">
  <a href="./docs/assets/easymde-logo-rounded.png">
    <img src="./docs/assets/easymde-logo-rounded.png" alt="EasyMDE" width="460" />
  </a>
</p>
<h1 align="center">EasyMDE</h1>
<p align="center">From Markdown to WordPress, without breaking your flow.</p>
<p align="center">
  <a href="https://github.com/tao-xiaoxin/EasyMDE/releases">
    <img src="https://img.shields.io/badge/version-0.1.7-2563eb?style=flat-square&logo=github&logoColor=white" alt="Version 0.1.7" />
  </a>
  <img src="https://img.shields.io/badge/WordPress-6.0%2B-21759b?style=flat-square&logo=wordpress&logoColor=white" alt="Requires WordPress 6.0+" />
  <img src="https://img.shields.io/badge/PHP-7.4%2B-777BB4?style=flat-square&logo=php&logoColor=white" alt="Requires PHP 7.4+" />
  <a href="https://github.com/tao-xiaoxin/EasyMDE/actions/workflows/ci.yml">
    <img src="https://github.com/tao-xiaoxin/EasyMDE/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI" />
  </a>
  <a href="./LICENSE">
    <img src="https://img.shields.io/badge/license-Apache--2.0-8b5cf6?style=flat-square" alt="Apache-2.0 license" />
  </a>
</p>

<p align="center">English | <a href="README.zh-CN.md">简体中文</a></p>

<p align="center">
  <a href="./docs/assets/easymde-editor-showcase.png">
    <img src="./docs/assets/easymde-editor-showcase.png" alt="EasyMDE split-pane Markdown editor with live preview, code highlighting, Mermaid, and KaTeX" width="1200" />
  </a>
</p>

EasyMDE is a standalone WordPress Markdown editor plugin. It provides an opt-in writing surface for posts and pages that should be authored as Markdown, while ordinary WordPress posts and pages continue to use Gutenberg.

EasyMDE stores Markdown as the source of truth, saves rendered HTML to `post_content` for WordPress compatibility, uses WordPress media/revisions/permissions/publishing flows, and ships local runtime assets instead of requiring Jetpack, Classic Editor, another Markdown plugin, or CDN-hosted editor/rendering libraries.

## Requirements

- WordPress 6.0 or newer.
- PHP 7.4 or newer.
- Composer runtime dependencies included in production release ZIPs.

## Installation

1. Download an EasyMDE release ZIP from [GitHub Releases](https://github.com/tao-xiaoxin/EasyMDE/releases), or place the plugin folder at `wp-content/plugins/easymde`.
2. In WordPress, go to **Plugins > Add New > Upload Plugin** for the ZIP, or activate the copied plugin from **Plugins**.
3. Create EasyMDE content from **Posts > Add EasyMDE Post** or **Pages > Add EasyMDE Page**.
4. Existing legacy EasyMDE posts with stored Markdown metadata also reopen in the EasyMDE editor.

Creating a normal post or page through the default WordPress flow keeps the normal Gutenberg editor.

## Features

**Writing workflow**

- Split Markdown source editor and live preview.
- Scroll synchronization between source and preview panes.
- Compact icon toolbar for common Markdown actions.
- Typora-inspired keyboard shortcuts with site-wide Windows/Linux and macOS overrides.
- WordPress media library image insertion.
- Browser local draft recovery, immersive writing mode, and editor dark mode.

**Rendering**

- Server-side Markdown rendering with `league/commonmark`.
- Raw Markdown HTML stripped and final HTML sanitized before output.
- Local Highlight.js, Mermaid, and KaTeX assets.
- `[TOC]` and `[toc]` table of contents support.

**Appearance**

- Per-post article themes and code themes.
- Optional CSS-only Mac-style code block frame.
- Per-post article font stack selection.
- Named per-user custom CSS styles, scoped and parsed before use.

**WordPress integration**

- Per-post/page opt-in editor mode.
- Rendered HTML saved to `post_content` for themes, feeds, search, and plugin compatibility.
- EasyMDE Markdown and appearance metadata included in WordPress revisions.
- Frontend pages load only the selected theme and the feature assets required by the current post.

**Publishing and export**

- Frontend rendering from stored Markdown when EasyMDE is active.
- Rich-text **Copy to WeChat** export from the current preview when browser clipboard support allows it.

## Documentation

- [Documentation index](docs/README.md)
- [User guide](docs/USER_GUIDE.md)
- [Development setup](docs/DEVELOPMENT.md)
- [Testing and release](docs/TESTING_AND_RELEASE.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Plugin Check notes](docs/PLUGIN_CHECK.md)
- [Upgrade notes](UPGRADING.md)
- [Security policy](SECURITY.md)
- [Contributing guide](CONTRIBUTING.md)
- [WordPress package readme](readme.txt)
- [Third-party notices](THIRD-PARTY-NOTICES.md)

## Development

Start with:

```bash
composer install
npm install
```

`npm install` runs the local runtime-asset preparation step for Highlight.js, Mermaid, and KaTeX assets under `assets/vendor/`. See [Development](docs/DEVELOPMENT.md) and [Testing and Release](docs/TESTING_AND_RELEASE.md) before changing runtime code, release packaging, or tests.

## License

EasyMDE is licensed under [Apache-2.0](LICENSE).
