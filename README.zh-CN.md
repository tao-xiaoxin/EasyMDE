<p align="center">
  <a href="./docs/assets/easymde-logo-rounded.png">
    <img src="./docs/assets/easymde-logo-rounded.png" alt="EasyMDE" width="460" />
  </a>
</p>
<h1 align="center">EasyMDE</h1>
<p align="center">在 WordPress 里用 Markdown 写作，同时保留原生发布流程。</p>
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

[English](README.md) | 简体中文

<p align="center">
  <a href="./docs/assets/easymde-editor-showcase.png">
    <img src="./docs/assets/easymde-editor-showcase.png" alt="EasyMDE 分栏 Markdown 编辑器截图" width="1200" />
  </a>
</p>

EasyMDE 是一个独立的 WordPress Markdown 编辑器插件。启用插件后，新建文章和页面会默认使用 EasyMDE，让作者用 Markdown 源文档写作、在右侧实时预览，并继续使用 WordPress 原生的媒体库、修订版本、权限和发布流程。

已经存在、且从未启用 EasyMDE 的普通文章和页面不会被自动转换；再次编辑时仍然使用 Gutenberg。EasyMDE 适合那些你希望长期保留 Markdown 源文档、同时又需要 WordPress HTML 兼容输出的文章。

## 运行要求

- WordPress 6.0 或更高版本。
- PHP 7.4 或更高版本。
- 正式发布 ZIP 会包含运行所需的 Composer 依赖。

## 安装

1. 从 [GitHub Releases](https://github.com/tao-xiaoxin/EasyMDE/releases) 下载 EasyMDE 发布 ZIP，或把插件目录放到 `wp-content/plugins/easymde`。
2. 在 WordPress 后台通过 **插件 > 安装插件 > 上传插件** 安装 ZIP，或在 **插件** 页面启用已经复制好的插件。
3. 需要写 Markdown 时，使用 **Posts > Add New** 或 **Pages > Add New** 创建内容。
4. 已经带有 EasyMDE Markdown 元数据的旧文章会继续用 EasyMDE 打开。

已有的普通 Gutenberg 文章或页面没有 EasyMDE 元数据时，重新编辑仍然会打开 Gutenberg。

## 使用方式

- 左侧写 Markdown，右侧查看实时预览。
- 工具栏提供常用格式、标题、列表、引用、代码、链接、图片和 WeChat 复制操作。
- 媒体按钮会调用 WordPress 媒体库，并把选中的图片插入为 Markdown 图片语法。
- 浏览器本地草稿可在重新打开编辑器时提示恢复；保存和发布仍由 WordPress 处理。
- 沉浸模式可以临时放大写作区域，深色模式会保存在当前浏览器的站点/用户上下文中。
- 每篇文章可以选择文章主题、代码主题、Mac 风格代码框和文章字体。

## 功能概览

**Markdown 写作**

- 分栏源文档和实时预览。
- 源文档与预览滚动同步。
- Typora 风格快捷键，并支持 Windows/Linux 与 macOS 分别配置。
- WordPress 媒体库图片插入。
- 本地草稿恢复、沉浸写作和编辑器深色模式。

**渲染能力**

- 使用 `league/commonmark` 在服务端渲染 Markdown。
- 原始 Markdown HTML 会被剥离，最终输出会经过 WordPress 安全过滤。
- 内置本地 Highlight.js、Mermaid、KaTeX 资源。
- 支持 `[TOC]` 和 `[toc]` 目录。

**外观与发布**

- 每篇文章独立保存文章主题、代码主题和字体设置。
- 支持 CSS-only 的 Mac 风格代码块边框。
- 支持命名的个人自定义 CSS；CSS 会先解析、限制范围，再用于预览和前台。
- 发布时保存 Markdown 源文档，同时把渲染后的 HTML 写入 `post_content`，方便主题、订阅、搜索和其他插件读取。
- 前台只加载当前文章需要的主题和功能资源，不依赖外部 CDN。

**微信复制**

- **Copy to WeChat** 会把当前预览复制为富文本，浏览器允许时同时写入 `text/html` 和 `text/plain`。
- 如果浏览器或权限策略不允许富文本剪贴板写入，EasyMDE 会尝试旧式复制方式；仍不可用时会显示错误提示，不会修改文章内容。

## 技术文档

目前技术文档以英文为准：

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

## 开发入口

本地开发通常从以下命令开始：

```bash
composer install
npm install
```

`npm install` 会准备 Highlight.js、Mermaid 和 KaTeX 的本地运行资源。修改代码、测试或发布流程前，请先阅读 [Development setup](docs/DEVELOPMENT.md) 和 [Testing and release](docs/TESTING_AND_RELEASE.md)。

## 许可证

EasyMDE 使用 [Apache-2.0](LICENSE) 许可证。
