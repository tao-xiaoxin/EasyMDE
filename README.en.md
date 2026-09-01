<p align="center">
  <a href="./docs/assets/easymde-logo-rounded.png">
    <img src="./docs/assets/easymde-logo-rounded.png" alt="EasyMDE" width="460" />
  </a>
</p>
<h1 align="center">EasyMDE - WordPress Markdown Editor Plugin</h1>
<p align="center">A Markdown editor plugin for WordPress writers, technical bloggers, and WeChat content creators, with split-pane live preview.</p>
<p align="center">
  <a href="https://github.com/tao-xiaoxin/EasyMDE/releases">
    <img src="https://img.shields.io/badge/version-0.1.9-2563eb?style=flat-square&logo=github&logoColor=white" alt="Version 0.1.9" />
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

EasyMDE is a Markdown editor plugin for WordPress writers, technical bloggers, and WeChat content creators. Write in Markdown, review a split-pane live preview, and keep using WordPress for editing, saving, publishing, and sharing.

<p align="center">
  <a href="https://github.com/tao-xiaoxin/EasyMDE/releases/latest/download/EasyMDE.zip"><strong>Download the installable EasyMDE.zip plugin</strong></a>
  · <a href="https://github.com/tao-xiaoxin/EasyMDE/releases/latest">Release notes</a>
</p>

<p align="center">
  <a href="./docs/assets/easymde-editor-showcase.png">
    <img src="./docs/assets/easymde-editor-showcase.png" alt="EasyMDE split-pane Markdown editor with live preview, code highlighting, Mermaid, and KaTeX" width="1200" />
  </a>
</p>

## Requirements

| Environment | Requirement |
| --- | --- |
| WordPress | 6.7 or newer |
| PHP | 7.4 or newer with the DOM extension enabled |

## Installation

1. Download `EasyMDE.zip` from the [GitHub Release](https://github.com/tao-xiaoxin/EasyMDE/releases/latest).
2. In WordPress, go to **Plugins > Add New > Upload Plugin**, upload `EasyMDE.zip`, and activate it.
3. Open **Posts** or **Pages** and start writing in Markdown.

## Features

### ✍️ Focused writing

- Split Markdown source editor and live preview.
- Scroll synchronization between source and preview panes.
- Compact icon toolbar for common Markdown actions.
- Typora-inspired keyboard shortcuts with site-wide Windows/Linux and macOS overrides.
- Browser local draft recovery with explicit restore, discard, and cross-tab conflict handling.
- Write beside the live preview on desktop; the panes stack vertically on narrow screens.

### 🧩 Rich content

- Common Markdown content such as headings, lists, links, images, tables, task lists, and code blocks.
- Code syntax highlighting, Mermaid diagrams, and KaTeX mathematical formulas.
- `[TOC]` and `[toc]` table of contents support.
- WordPress Media Library insertion through the toolbar media picker.
- Optional Image Hosting for local image paste and drag-and-drop, with Cloudflare R2, Qiniu Kodo, Alibaba Cloud OSS, or Tencent Cloud COS.

### 🎨 Personal appearance

- Per-post article themes and code themes.
- Use the selected appearance on published content, or keep it in editor Preview only.
- Show published code-block copy buttons by default; hide them when you prefer while keeping code rendering and syntax highlighting.
- Per-post article font stack selection.
- With the required permission, save named custom CSS styles and reuse them when needed.

### 🧭 WordPress integration

- Write from the normal WordPress **Posts** and **Pages** editing screens.
- Continue using WordPress Media Library, categories, tags, excerpts, featured images, and revisions.
- Use WordPress's native save, publishing, and permission workflows.
- No Jetpack, Classic Editor, or another Markdown plugin is required.

### 📤 Publishing and sharing

- Publish formatted articles through WordPress.
- Copy the current preview as rich text to the WeChat Official Accounts editor.

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

For more, see [Development setup](docs/DEVELOPMENT.md) and [Testing and release](docs/TESTING_AND_RELEASE.md).

## Support EasyMDE

<p align="center">
  If EasyMDE improves your WordPress writing flow, a star helps more writers discover the project.
</p>

## License

EasyMDE is licensed under [Apache-2.0](LICENSE).
