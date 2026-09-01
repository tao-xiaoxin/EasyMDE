<p align="center">
  <a href="./docs/assets/easymde-logo-rounded.png">
    <img src="./docs/assets/easymde-logo-rounded.png" alt="EasyMDE" width="460" />
  </a>
</p>
<h1 align="center">EasyMDE - WordPress Markdown 编辑器插件</h1>
<p align="center">面向 WordPress 写作者、技术博客作者和微信内容创作者的 Markdown 编辑器插件，提供分栏实时预览。</p>
<p align="center">
  <a href="https://github.com/tao-xiaoxin/EasyMDE/releases">
    <img src="https://img.shields.io/badge/version-0.1.9-2563eb?style=flat-square&logo=github&logoColor=white" alt="版本 0.1.9" />
  </a>
  <img src="https://img.shields.io/badge/WordPress-6.7%2B-21759b?style=flat-square&logo=wordpress&logoColor=white" alt="需要 WordPress 6.7+" />
  <img src="https://img.shields.io/badge/PHP-7.4%2B-777BB4?style=flat-square&logo=php&logoColor=white" alt="需要 PHP 7.4+" />
  <a href="https://github.com/tao-xiaoxin/EasyMDE/actions/workflows/ci.yml">
    <img src="https://github.com/tao-xiaoxin/EasyMDE/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI" />
  </a>
  <a href="./LICENSE">
    <img src="https://img.shields.io/badge/license-Apache--2.0-8b5cf6?style=flat-square" alt="Apache-2.0 许可证" />
  </a>
</p>

<p align="center">简体中文 | <a href="README.en.md">English</a></p>

EasyMDE 是一个面向 WordPress 写作者、技术博客作者和微信内容创作者的 Markdown 编辑器插件。用 Markdown 写作，在分栏实时预览中检查内容，并沿用 WordPress 的编辑、保存、发布和分享流程。

<p align="center">
  <a href="https://github.com/tao-xiaoxin/EasyMDE/releases/latest/download/EasyMDE.zip"><strong>下载插件</strong></a>
  · <a href="https://github.com/tao-xiaoxin/EasyMDE/releases/latest">最新发布</a>
</p>

<p align="center">
  <a href="./docs/assets/easymde-editor-showcase.png">
    <img src="./docs/assets/easymde-editor-showcase.png" alt="EasyMDE 分栏 Markdown 编辑器，带实时预览、代码高亮、Mermaid 和 KaTeX" width="1200" />
  </a>
</p>

## 要求

| 环境 | 要求 |
| --- | --- |
| WordPress | 6.7 或更高版本 |
| PHP | 7.4 或更高版本，并启用 DOM 扩展 |

## 安装

1. 下载 [GitHub Release](https://github.com/tao-xiaoxin/EasyMDE/releases/latest) 中的 `EasyMDE.zip`。
2. 在 WordPress 后台进入 **插件 > 安装插件 > 上传插件**，上传并启用 `EasyMDE.zip`。
3. 打开 **文章** 或 **页面**，开始用 Markdown 写作。

## 功能

### ✍️ 专注写作

- 分栏 Markdown 源文档编辑器和实时预览。
- 源文档与预览窗格滚动同步。
- 用于常见 Markdown 操作的紧凑图标工具栏。
- 受 Typora 启发的快捷键，并支持站点级 Windows/Linux 和 macOS 覆盖设置。
- 浏览器本地草稿恢复支持明确恢复、丢弃和跨标签页冲突处理。
- 桌面端并排写作与预览，窄屏下上下排列。

### 🧩 丰富内容

- 支持标题、列表、链接、图片、表格、任务列表和代码块等常用 Markdown 内容。
- 支持代码语法高亮、Mermaid 图表和 KaTeX 数学公式。
- 支持 `[TOC]` 和 `[toc]` 目录。
- 通过工具栏媒体选择器插入 WordPress 媒体库内容。
- 可选的图床上传用于本地图片粘贴和拖放，支持 Cloudflare R2、七牛云 Kodo、阿里云 OSS 和腾讯云 COS。

### 🎨 个性外观

- 每篇文章独立选择文章主题和代码主题。
- 选定外观可应用于已发布内容，也可以只用于编辑器预览。
- 已发布代码块默认显示复制按钮；可按需隐藏，同时保留代码渲染和语法高亮。
- 每篇文章独立选择文章字体栈。
- 具备相应权限时，可保存命名的自定义 CSS 样式，并按需复用于文章。

### 🧭 融入 WordPress

- 在 WordPress 正常的 **文章** 和 **页面** 编辑入口中写作。
- 继续使用 WordPress 的媒体库、分类、标签、摘要、特色图片和修订版本。
- 使用 WordPress 原生的保存、发布和权限流程。
- 不需要 Jetpack、Classic Editor 或其他 Markdown 插件。

### 📤 发布与分享

- 在 WordPress 页面中发布排版后的文章内容。
- 将当前预览以富文本 **复制到微信**，用于微信公众号编辑器。

## 技术文档

- [文档索引](docs/README.md)
- [用户指南](docs/USER_GUIDE.md)
- [开发设置](docs/DEVELOPMENT.md)
- [测试与发布](docs/TESTING_AND_RELEASE.md)
- [架构](docs/ARCHITECTURE.md)
- [Plugin Check 说明](docs/PLUGIN_CHECK.md)
- [升级说明](UPGRADING.md)
- [安全策略](SECURITY.md)
- [贡献指南](CONTRIBUTING.md)
- [WordPress 软件包 readme](readme.txt)
- [第三方声明](THIRD-PARTY-NOTICES.md)

## 开发

从以下命令开始：

```bash
composer install
npm install
npm run assets:check
```

更多请参阅 [开发设置](docs/DEVELOPMENT.md) 和 [测试与发布](docs/TESTING_AND_RELEASE.md)。

## 支持 EasyMDE

<p align="center">
  如果 EasyMDE 改善了你的 WordPress 写作流程，点亮 Star 可以帮助更多作者发现这个项目。
</p>

## 许可证

EasyMDE 使用 [Apache-2.0](LICENSE) 许可证。
