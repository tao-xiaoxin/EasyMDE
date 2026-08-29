<p align="center">
  <a href="./docs/assets/easymde-logo-rounded.png">
    <img src="./docs/assets/easymde-logo-rounded.png" alt="EasyMDE" width="460" />
  </a>
</p>
<h1 align="center">EasyMDE - WordPress Markdown Editor Plugin</h1>
<p align="center">A standalone WordPress Markdown editor plugin, from Markdown to WordPress without breaking your flow.</p>
<p align="center">
  <a href="https://github.com/tao-xiaoxin/EasyMDE/releases">
    <img src="https://img.shields.io/badge/version-0.1.8-2563eb?style=flat-square&logo=github&logoColor=white" alt="Version 0.1.8" />
  </a>
  <img src="https://img.shields.io/badge/WordPress-6.7%2B-21759b?style=flat-square&logo=wordpress&logoColor=white" alt="Requires WordPress 6.7+" />
  <img src="https://img.shields.io/badge/PHP-7.4%2B-777BB4?style=flat-square&logo=php&logoColor=white" alt="Requires PHP 7.4+" />
  <a href="https://github.com/tao-xiaoxin/EasyMDE/actions/workflows/ci.yml">
    <img src="https://github.com/tao-xiaoxin/EasyMDE/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI" />
  </a>
  <a href="./LICENSE">
    <img src="https://img.shields.io/badge/license-Apache--2.0-8b5cf6?style=flat-square" alt="Apache-2.0 license" />
  </a>
</p>

<p align="center"><a href="README.md">简体中文</a> | English</p>

EasyMDE is a standalone WordPress Markdown editor plugin, not the unrelated EasyMDE JavaScript editor library. It lets new and existing supported WordPress content use EasyMDE through the normal WordPress editor entry points.

<p align="center">
  <a href="https://github.com/tao-xiaoxin/EasyMDE/releases/latest/download/EasyMDE.zip"><strong>Download the installable EasyMDE.zip plugin</strong></a>
  · <a href="https://github.com/tao-xiaoxin/EasyMDE/releases/latest">Release notes</a>
</p>

<p align="center">
  <a href="./docs/assets/easymde-editor-showcase.png">
    <img src="./docs/assets/easymde-editor-showcase.png" alt="EasyMDE split-pane Markdown editor with live preview, code highlighting, Mermaid, and KaTeX" width="1200" />
  </a>
</p>

Opening ordinary existing content is zero-write: before the author saves through EasyMDE, it does not convert content, write metadata, rewrite `post_content`, or create a revision.

EasyMDE stores Markdown as the source of truth, saves rendered HTML to `post_content` for WordPress compatibility, uses WordPress media/revisions/permissions/publishing flows, and ships local runtime assets instead of requiring Jetpack, Classic Editor, another Markdown plugin, or CDN-hosted editor/rendering libraries.

Plugin JavaScript, CSS, fonts, icons, and rendering libraries remain bundled locally. An administrator can also configure Image Hosting for local image paste and drag-and-drop uploads.

## Requirements

- WordPress 6.7 or newer.
- PHP 7.4 or newer with the DOM extension enabled.
- Composer runtime dependencies included in the production `EasyMDE.zip` release asset.

## Installation

1. Download the GitHub Release asset `EasyMDE.zip` from the link above. GitHub's automatically generated Source code ZIP/TAR.GZ files are source archives, not installable plugins, and cannot be used for installation.
2. In WordPress, go to **Plugins > Add New > Upload Plugin**, upload and install `EasyMDE.zip`, then activate the plugin.
3. Open or create content from the normal WordPress **Posts**, **Pages**, or other post-type screens supported by `easymde_supported_post_types`.
4. Supported content opens in EasyMDE. Existing EasyMDE content keeps using stored Markdown metadata, while ordinary content uses an in-memory Markdown import of current `post_content` until first save.

## Features

**Writing workflow**

- Split Markdown source editor and live preview.
- Scroll synchronization between source and preview panes.
- Compact icon toolbar for common Markdown actions.
- Typora-inspired keyboard shortcuts with site-wide Windows/Linux and macOS overrides.
- Explicit WordPress media-library insertion through the toolbar media picker.
- Optional protected Image Hosting uploads for local image paste and drag-and-drop, configurable with Cloudflare R2, Qiniu Kodo, Alibaba Cloud OSS, or Tencent Cloud COS.
- Browser local draft recovery with explicit restore, discard, and cross-tab conflict handling.
- Fixed 50/50 desktop source/preview workspace with the historical responsive stack at narrow widths.
- WordPress-native publishing, categories, tags, excerpts, featured images, and revisions remain available in their existing Meta Boxes.

**Rendering**

- Server-side Markdown rendering with `league/commonmark`.
- Raw Markdown HTML stripped and final HTML sanitized before output.
- Local Highlight.js, Mermaid, and KaTeX assets.
- `[TOC]` and `[toc]` table of contents support.

**Appearance**

- Per-post article themes and code themes.
- The Settings Center applies the editor's selected appearance to published
  content by default. Disable this linkage to keep the selected appearance in
  editor Preview while public content uses EasyMDE's neutral default appearance.
- Fixed CSS-only Mac-style frame for rendered code blocks, loaded only when code content needs it.
- Published code blocks show a copy button by default; the Settings Center can
  disable that control without disabling code rendering or syntax highlighting.
- Per-post article font stack selection.
- Named per-user custom CSS styles, scoped and parsed before use.

**WordPress integration**

- EasyMDE editor mode for new and existing supported post types.
- Metadata-based document state for Markdown source, rendering settings, and compatibility output.
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
npm run assets:check
```

Highlight.js, Mermaid, and KaTeX are sourced from locked npm packages, prepared explicitly under `assets/vendor/` only when their dependency or manifest changes, committed, and shipped with the plugin. Runtime requests stay local; CI and release builds use the read-only asset check and fail on missing, changed, or unexpected managed files. See [Development](docs/DEVELOPMENT.md) and [Testing and Release](docs/TESTING_AND_RELEASE.md) before changing runtime code, release packaging, or tests.

## Support EasyMDE

<p align="center">
  If EasyMDE improves your WordPress writing flow, a star helps more writers discover the project.
</p>

## License

EasyMDE is licensed under [Apache-2.0](LICENSE).
