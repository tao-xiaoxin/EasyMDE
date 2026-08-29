---
name: easymde-i18n
description: Use this skill when adding, changing, migrating, reviewing, or validating EasyMDE user-facing strings, PHP Gettext calls, React/TypeScript translations, locale-aware formatting, RTL behavior, translation catalogs, loading, or release-package language assets.
---

# EasyMDE i18n Skill

这个 Skill 负责 EasyMDE 的用户可见文案、PHP Gettext、React/TypeScript
翻译、locale/RTL、catalog、加载和语言资源交付。它不替代 `AGENTS.md`、
`.agents/skills/easymde/SKILL.md`、`docs/ARCHITECTURE.md` 或
`docs/TESTING_AND_RELEASE.md`。

## 先读什么

规则优先级如下：当前 Human 指令和明确决定、`AGENTS.md` 与 live code、
聚焦 Issue/PR、负责当前架构的文档、其他相关 Skill、官方文档。下层资料
不能把计划能力写成当前事实。

- 当前实现、owner、提取、catalog、Script Handle、loader/main、扩展 API
  和发布包证据：读取 [current-contract.md](references/current-contract.md)。
- PHP 或 Bootstrap owner 转给 React/TypeScript，或删除旧字段：读取
  [owner-transfer.md](references/owner-transfer.md)。
- 普通 React/TypeScript 功能同时遵循 `easymde` Skill；输入、权限、日志
  或隐私风险按需读取安全相关 Skill。

开始前读取与改动直接相关的 source、consumer、entrypoint、catalog、构建
manifest 和测试。不要依据旧 Issue、示例项目或理想架构猜测当前行为。

## 单一 owner

每一个用户可见消息实例、交互状态和 Bootstrap 字段只有一个翻译 owner。

- PHP 直接渲染或 PHP 组装的 Bootstrap 值由 PHP Gettext 提供。
- 已迁移的 React/TypeScript 消息由其拥有该渲染实例的 Feature 使用
  `@wordpress/i18n` 提供。
- 普通/沉浸式 Editor Root、独立 Settings Center 和公开文章增强是三个不同
  运行面；不得交换各自 Bootstrap 数据，也不得让同一实例同时经过两条
  翻译路径。
- 后台 Editor Root bootstrap 命名保持 `EasyMDEEditorRootBootstrap`，Settings
  Center 字符串保持 `EasyMDESettingsCenterBootstrap.strings`，公开前台字符串
  保持 `EasyMDEFrontendConfig.strings`。不要把后台两个 surface 合并成一个
  map，不要创建旧别名或第二份字符串 map。
- 相同英文只有在语义、context、consumer、生命周期和删除策略都一致时才
  能共享；否则按 Feature 保持独立。

React 不成为第二个文档、权限、持久化、发布、locale 或翻译 authority。
不要把翻译结果放进 Root Store、Post Meta、Options、Storage、Recovery
Draft 或其他稳定状态。稳定数据可以持久化，当前 locale 的显示结果不可以。

## 文案边界

应该进入翻译管道的内容包括标题、按钮、错误和成功状态、帮助、空状态、
提示、tooltip、ARIA 名称、状态播报、快捷键说明和带 placeholder 的完整
人类语言句子。原始数字、百分比、时间戳、ISO 值和机器标识不作为 msgid；
先按 WordPress locale/站点时区格式化，再作为 placeholder 插入完整句子。

不要翻译文章标题、正文、摘要、标签、分类、Markdown、CSS、正则、Shell
命令、REST 路由和参数、HTTP 状态、错误码、meta/option 名称、Script
Handle、class/id、HTML 属性、selector、Storage key、command id、model
或 provider id。

## PHP 规则

只在 PHP 渲染或仍由 PHP 负责的 Bootstrap 场景使用 Gettext：

- 普通字符串用 `__()`，歧义术语用 `_x()`，计数用 `_n()`/`_nx()`；输出
  上下文使用 `esc_html__()`、`esc_attr__()` 等对应 API。
- msgid、context、domain 使用字面量；禁止变量或动态拼接 msgid。
- 占位符、歧义词和历史术语写 `translators:` 注释。计数先用原始数值
  选择复数，再用 `number_format_i18n()` 等 locale API 格式化显示值。
- 不要在文件作用域预先初始化翻译字符串；按调用时的 WordPress locale
  获取值。
- 对动态扩展值，只遵循当前扩展 API 合同，不把用户数据或扩展标识符当作
  新的稳定消息源。

## React/TypeScript 规则

已激活的 React owner 从 `@wordpress/i18n` 导入 `__`、`_x`、`_n` 和
`sprintf`，并在拥有渲染实例的 Feature 附近翻译：

```ts
import { __, _n, sprintf } from '@wordpress/i18n';

const title = __( 'Live preview', 'easymde' );
const label = sprintf(
  /* translators: %s: locale-formatted revision count. */
  _n( '%s revision', '%s revisions', count, 'easymde' ),
  formattedCount,
);
```

- source message、context、domain 和 placeholder 必须是提取器可识别的
  字面量；禁止拼接可翻译句子或把 translated text 当 key、selector 或
  storage key。
- `_n()` 接收原始数值；显示值遵循 WordPress locale 的格式化规则。
  placeholder 数量、顺序和类型必须一致，注释必须解释语义和参数。
- 不创建无边界的全局消息桶或自建翻译 runtime。可选/lazy Feature 只有在
  它的消息在激活时确有可加载合同后才能拥有用户文案。
- 无提取、catalog、加载或包证据时，不得用自定义 inline English fallback
  掩盖故障；应让项目合同失败可观察，同时保持 source locale 页面不空白。

## Locale、RTL 与可访问性

WordPress 请求 locale 和方向是 authority；不得用浏览器 locale、平台语言
或本地切换器决定翻译、权限或产品状态。PHP 使用 WordPress 的 locale 数字、
日期和时区 API；JS 使用 bootstrap/WordPress 提供的 locale，并在等价能力
已验证时使用 `Intl`。方向来自 `is_rtl()`/WordPress `isRTL()` 合同，不由
浏览器猜测。

可访问名称、dialog label、说明、错误、状态播报和 tooltip 与普通文案遵循
同一 owner。翻译后的可访问名称必须真的连接到 control；ARIA 字符串通过
文案检查不等于无障碍行为已经通过，必须验证 role、name、description、
focus、顺序、disabled/pending/error 状态和长文案布局。

## Source English 与失败

source English 可以是 source locale，也可以是 WordPress 没有对应社区翻译
时的正常 Gettext 结果。对于项目声明维护的非英语 locale，缺少源提取、
catalog、JSON、domain、Handle、资源路径、加载顺序或包内文件是合同故障。

合同故障必须有稳定错误码或最小诊断上下文，不能把原始文章、服务器错误、
凭据或 token 写进日志。不要把空字符串、mock、浏览器语言或另一套全局
catalog 当成功。错误状态、恢复边界和未验证的真实运行时证据必须明确记录。

## 迁移与发布

owner 转移是一个可独立验收的消息或 Feature 单元。迁移矩阵、提取/加载
顺序、旧 Bootstrap 字段与 consumer 的删除、重复 owner 搜索和失败恢复证据
统一遵循 [owner-transfer.md](references/owner-transfer.md)。未完成该证据链
时，未迁移文案继续由原 owner 提供，React 不得抢占它。

安装版 plugin ZIP 与 source archive 是不同产品。语言源文件、编译产物、
已激活的 JavaScript catalog 和开发源的 Include/Exclude 以当前发布合同为
准；不要在本 Skill 内复制完整发布清单、另造中间产物或把静态文件存在当成
浏览器运行成功。任何语言资源改动都要检查提取、catalog、运行时加载、包内
路径和未授权远端资源。

## 最小验证

按改动范围执行并报告真实结果：

1. 源 owner、literal msgid、context、复数、ARIA 和 locale/RTL 静态检查；
2. `npm run i18n:check`，以及受影响的 Node、frontend、构建和 release 检查；
3. 可用时在版本匹配的 WordPress 6.7 环境运行真实 locale 入口，观察用户
   可见的翻译加载；静态注册、文件存在和包内存在不能替代这一步；
4. 检查 installable ZIP 与 source archive 的边界，确保没有临时提取物、
   开发缓存、私密数据或不受 owner 管理的语言资产。

无法执行的浏览器、非英语 JSON 可见加载、复杂布局、长文案或发布重放证据
必须写为 `unverified`，不能用编译成功、mock 或截图推断完成。
