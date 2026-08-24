<p align="center">
  <a href="./docs/assets/easymde-logo-rounded.png">
    <img src="./docs/assets/easymde-logo-rounded.png" alt="EasyMDE" width="460" />
  </a>
</p>
<h1 align="center">EasyMDE</h1>
<p align="center">在 WordPress 里用 Markdown 写作，同时保留原生发布流程。</p>
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

[English](README.md) | 简体中文

<p align="center">
  <a href="./docs/assets/easymde-editor-showcase.png">
    <img src="./docs/assets/easymde-editor-showcase.png" alt="EasyMDE 分栏 Markdown 编辑器截图" width="1200" />
  </a>
</p>

EasyMDE 是一个独立的 WordPress Markdown 编辑器插件。启用插件后，新建和已有的文章、页面都会通过 WordPress 正常编辑入口使用 EasyMDE，让作者用 Markdown 源文档写作、在右侧实时预览，并继续使用 WordPress 原生的媒体库、修订版本、权限和发布流程。

已有的普通文章和页面在打开编辑器时不会被自动转换，也不会立即写入元数据或改写内容。只有作者从 EasyMDE 正常保存后，插件才会建立 Markdown 文档状态并同步 WordPress 兼容 HTML 输出。

插件自身的 JavaScript、CSS、字体、图标和渲染库始终随插件本地提供。文章图片属于独立的数据流：只有管理员配置图床后，作者粘贴或拖放本地图片时才会上传到所选图床。

## 运行要求

- WordPress 6.7 或更高版本。
- PHP 7.4 或更高版本。
- 正式发布 ZIP 会包含运行所需的 Composer 依赖。

## 安装

1. 从 [GitHub Releases](https://github.com/tao-xiaoxin/EasyMDE/releases) 下载 EasyMDE 发布 ZIP，或把插件目录放到 `wp-content/plugins/easymde`。
2. 在 WordPress 后台通过 **插件 > 安装插件 > 上传插件** 安装 ZIP，或在 **插件** 页面启用已经复制好的插件。
3. 从 WordPress 正常的 **Posts** 和 **Pages** 列表或新建入口打开内容。
4. 受支持的文章和页面会使用 EasyMDE。已有 EasyMDE Markdown 元数据的内容继续读取 Markdown；普通旧内容会先把当前 `post_content` 在内存中导入为 Markdown，直到第一次正常保存。

## 使用方式

- 左侧写 Markdown，右侧查看实时预览。
- 工具栏提供常用格式、标题、列表、引用、代码、链接、图片和 WeChat 复制操作。
- 媒体按钮是独立的 WordPress 原生入口：它会打开媒体库，并把选中的图片插入为 Markdown 图片语法。
- 从剪贴板粘贴或拖放本地图片时，只会通过受保护的同源图床上传路径发送到管理员配置的 Cloudflare R2、七牛云 Kodo、阿里云 OSS 或腾讯云 COS；任一服务均可作为主图床或可选的同对象 Key 备份图床，该路径不会自动重试、切换服务或回退到 WordPress 媒体库。
- 浏览器本地草稿可在重新打开编辑器时提示恢复；保存和发布仍由 WordPress 处理。
- 点击“进入沉浸写作”后会打开一套独立的全屏文章工作台；未进入时，原 WordPress 编辑页面的布局和样式保持不变。
- 独立工作台继续使用真实的 Markdown、预览、媒体、主题、修订版本与 WordPress 原生保存发布链路。
- 每篇文章可以选择文章主题、代码主题、Mac 风格代码框和文章字体。

## 功能概览

**Markdown 写作**

- 分栏源文档和实时预览。
- 源文档与预览滚动同步。
- Typora 风格快捷键，并支持 Windows/Linux 与 macOS 分别配置。
- 通过工具栏媒体按钮明确进入 WordPress 媒体库并插入图片。
- 本地图片粘贴和拖放通过受保护的同源图床路径上传到管理员配置的 Cloudflare R2、七牛云 Kodo、阿里云 OSS 或腾讯云 COS；任一服务均可作为主图床或可选的同对象 Key 备份图床，该路径不自动重试、切换服务或回退到 WordPress 媒体库。
- 本地草稿恢复和独立沉浸写作工作台。

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
- 前台只加载当前文章需要的插件主题和功能资源，不依赖外部 CDN；文章本身引用的图片可以来自管理员配置的图床公开域名。

**微信复制**

- **Copy to WeChat** 只复制当前已经完成的预览；现代 Clipboard API 会从同一份安全副本写入 `text/html` 和 `text/plain`。旧式复制只在同一份序列化结果已经准备好时于点击任务内同步执行；准备仍在进行或现代写入异步被拒绝时会明确失败。若 `ClipboardItem` 构造或 `write()` 调用本身同步抛错，则可以在同一点击任务内使用已准备的旧式 payload，不会跨异步边界回退。
- 沉浸模式直接编辑预览后会合并快速输入，再准备当前 HTML；序列化前会核对预览当前标记，避免复用旧 payload。主题装饰节点保留必要的尺寸、定位、Flex 尺寸、浮动和溢出样式，复制的背景图保持在正文文字后方，计算后的 `0%`、`50%`、`100%` 背景位置会在复制时转换，保证居中装饰不偏移；行内图片和视频保留原有显示方式与边距，只增加响应式尺寸限制。
- 代码、表格和过长的块级公式只在超出公众号列宽时保留水平滚动，行内公式保持不换行；不会由导出器给整篇文章增加纵向滚动容器，KaTeX 的 MathML 备用树和编辑器临时节点也不会被复制。
- 预览为空、加载中或失败时不会触碰剪贴板；两条路径都失败会显示错误且不修改文章内容，重复点击会合并为一次复制。

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
npm run assets:check
```

Highlight.js、Mermaid、KaTeX 和 Lucide 来自锁定的 npm 包，并以已提交文件的形式随插件发布。常规依赖安装不会改写这些文件；只有在依赖版本或资源清单有意变更时，才运行 `npm run prepare:assets` 刷新资源并审查差异。CI 和发布流程通过只读的 `npm run assets:check` 检查缺失、变更或额外文件。修改代码、测试或发布流程前，请先阅读 [Development setup](docs/DEVELOPMENT.md) 和 [Testing and release](docs/TESTING_AND_RELEASE.md)。

## 许可证

EasyMDE 使用 [Apache-2.0](LICENSE) 许可证。
