<p align="center">
  <a href="./docs/assets/easymde-logo-rounded.png">
    <img src="./docs/assets/easymde-logo-rounded.png" alt="EasyMDE" width="460" />
  </a>
</p>
<h1 align="center">EasyMDE - WordPress Markdown Editor Plugin</h1>
<p align="center">The best Markdown editing plugin built for WordPress, delivering an ultimate immersive writing experience.</p>
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

A next-generation WordPress Markdown editor built for content creators, with live preview, Mermaid diagrams, KaTeX formulas, image hosting, native publishing, revisions, and one-click copying to WeChat Official Accounts, making writing, formatting, and publishing more efficient.

<p align="center">
  <a href="https://github.com/tao-xiaoxin/EasyMDE/releases/latest/download/EasyMDE.zip"><strong>Download Plugin</strong></a>
  · <a href="https://github.com/tao-xiaoxin/EasyMDE/releases/latest">Latest Release</a>
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

- ✅ **Split-pane live preview:** the source document and preview pane scroll in sync.
- ✅ **Professional quick toolbar:** insert images through the toolbar media picker and format bold and other Markdown with one click.
- ✅ **Typora-inspired keyboard shortcuts:** site-wide Windows/Linux and macOS override settings.
- ✅ **Immersive editing:** the immersive editor accepts `~~~` or backtick fence shortcuts for quick code-block input.
- ✅ **Auto-save:** drafts are saved at the configured interval to reduce the risk of losing work.
- ✅ **Local draft recovery:** explicitly restore editing drafts from different points in time.
- ✅ **Common Markdown syntax:** code highlighting, Mermaid diagrams, and KaTeX formulas.

### ⚙️ Settings Center

- ✅ **Built-in image hosting:** Cloudflare R2, Qiniu Kodo, Alibaba Cloud OSS, and Tencent Cloud COS, with optional primary/backup destinations, file-name rules, and upload retries.
- ✅ **Customizable shortcuts:** configure toolbar shortcuts separately for Windows/Linux and macOS, with automatic conflict detection.
- ✅ **Markdown preferences:** word wrap, GitHub-flavored Markdown, smart punctuation, table alignment, code line numbers, and paste as Markdown.
- ✅ **General preferences:** auto-save interval, applying the editor theme to the frontend, and published code-copy buttons.
- ✅ **Settings transfer:** import and export all preferences for easy migration and backup.

### 🎨 Personal appearance

- ✅ **10+ font styles built in:** choose an independent font style per post.
- ✅ **Code copy:** published posts show code-block copy buttons by default; hide them when you prefer.
- ✅ **40+ article themes and 10+ code themes built in:** pick an independent article theme and code theme per post.
- ✅ **Custom appearance:** apply the selected look to published content, or keep it in the editor preview only.
- ✅ **Custom code and article styles:** customize and reuse code and article theme styles when you save.

### 📤 Publishing and sharing

- ✅ **One-click copy to WeChat Official Accounts:** copy the current preview as rich text and paste it into the Official Accounts editor.

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
  If EasyMDE improves your WordPress writing flow, please give us a star.
</p>

## License

EasyMDE is licensed under [Apache-2.0](LICENSE).
