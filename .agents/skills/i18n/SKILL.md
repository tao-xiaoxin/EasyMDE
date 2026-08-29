---
name: easymde-i18n
description: Use this skill when adding, changing, migrating, reviewing, or validating EasyMDE user-facing strings, PHP Gettext calls, React/TypeScript translations, locale-aware formatting, RTL behavior, translation catalogs, loading, or release-package language assets.
---

# EasyMDE i18n Skill

这个 Skill 指导 EasyMDE 的用户可见文案、PHP Gettext、React/TypeScript
翻译、locale/RTL、catalog、加载和语言资源交付；不替代 `AGENTS.md`、
`.agents/skills/easymde/SKILL.md`、`docs/ARCHITECTURE.md` 或
`docs/TESTING_AND_RELEASE.md`。

## 路由与事实

规则优先级是当前 Human 指令和决定、`AGENTS.md`/live code、聚焦 Issue/PR、
当前架构文档、相关 Skill、官方文档。下层资料不能把计划写成事实。

- 当前 owner、提取、catalog、Script Handle、loader/main、扩展 API、包证据：
  读 [current-contract.md](references/current-contract.md)。
- owner 转移或删除旧 Bootstrap 字段：读
  [owner-transfer.md](references/owner-transfer.md)。
- 普通 React/TypeScript 改动同时遵循 `easymde` Skill；输入、权限、日志和
  隐私风险按需读取相关 Skill。

开始前读取改动直接相关的 source、consumer、entrypoint、catalog、manifest
和测试；不要依赖旧 Issue、示例项目或理想架构猜测当前行为。

## 单一 owner

每个用户可见消息实例、交互状态和 Bootstrap 字段只有一个翻译 owner。

- PHP 渲染或组装的 Bootstrap 值由 PHP Gettext 提供；已迁移的 React 文案由
  拥有渲染实例的 Feature 使用 `@wordpress/i18n` 提供。
- 当前运行面、owner、Bootstrap 字段和 map 以
  [current-contract.md](references/current-contract.md) 为准；不得在本 Skill
  复制 live 实现快照。独立运行面保持隔离，不得交换数据、合并 map 或创建
  别名，也不共享翻译 State。
- 相同英文只有在语义、context、consumer、生命周期和删除策略一致时才共享；
  不要把翻译结果放进 Store、Post Meta、Options、Storage 或 Recovery Draft。

React 不成为第二个文档、权限、持久化、发布、locale 或翻译 authority。

## 文案边界

标题、按钮、状态、帮助、空状态、提示、tooltip、ARIA 名称、状态播报、快捷
键说明和带 placeholder 的完整句子进入翻译管道。原始数字、百分比、时间戳、
ISO 值和机器标识先按 WordPress locale/站点时区格式化，再插入完整句子。

不要翻译文章内容、Markdown、CSS、正则、Shell 命令、REST 路由/参数、HTTP
状态、错误码、meta/option 名称、Script Handle、class/id、HTML 属性、
selector、Storage key、command/model/provider id。

## PHP 与 TypeScript

- PHP：普通字符串用 `__()`，歧义术语用 `_x()`，计数用 `_n()`/`_nx()`；按
  输出上下文使用 escaping API。msgid、context、domain 必须是字面量；占位
  符、歧义词和历史术语写 `translators:` 注释。先用原始 count 选复数，再用
  `number_format_i18n()` 等 API 格式化显示值；不要在文件作用域初始化翻译。
- React/TypeScript：从 `@wordpress/i18n` 导入 `__`、`_x`、`_n`、`sprintf`，
  在 Feature 附近翻译。source/context/domain/placeholder 用可提取字面量，
  `_n()` 接收原始 count，格式化值单独插入；placeholder 数量、顺序、类型和
  `translators:` 说明必须一致。禁止拼接句子、translated text 充当 key 或
  自建 runtime/global message bucket；可选 Feature 需先有可加载合同。
- 动态扩展值遵循当前扩展 API 合同，不把用户数据或扩展标识符变成消息源。

## Locale、RTL、无障碍

WordPress 请求 locale、方向、数字、日期和站点时区是 authority；禁止浏览器
locale、平台语言或本地切换器决定翻译、权限或产品状态。JS 使用 bootstrap/
WordPress locale；方向来自 `is_rtl()`/WordPress `isRTL()`，不可猜测。

ARIA 文案与普通文案共享 owner，但翻译检查不等于无障碍通过；验证 role、
name、description、focus、顺序、disabled/pending/error 状态和长文案布局。

## Source English、失败与隐私

source English 可是 source locale 或无社区翻译时的正常 Gettext 结果。维护的
非英语 locale 若缺少提取、catalog、JSON、domain、Handle、路径、加载顺序或
包内文件，就是合同故障；不可用空字符串、inline English fallback、mock、
浏览器语言或另一套 catalog 掩盖。以稳定错误码和最小诊断暴露错误，不记录文章、
服务器原错、凭据或 token；
明确恢复边界和真实 runtime 的未验证项。

## 迁移、发布与验证

owner 转移必须是可独立验收的消息/Feature 单元，清单、顺序、旧字段/consumer
删除、重复 owner 搜索和失败恢复证据遵循 [owner-transfer.md](references/owner-transfer.md)。
未迁移文案继续由原 owner 提供，目标证据不完整时 React 不得抢占。

Installable plugin ZIP 与 source archive 是不同产品；语言源、编译产物、激活
catalog、开发源和临时文件遵循当前发布合同，不在本 Skill 复制完整清单或把
静态存在当成浏览器成功，也不引入未授权远端资源。

按范围执行并报告：

1. owner、literal msgid、context、复数、ARIA、locale/RTL 静态检查；
2. `npm run i18n:check` 及受影响的 Node、frontend、build、release 检查；
3. 版本匹配 WordPress 6.7 的真实非英语 locale 入口（若可用）；静态注册、
   文件存在、包内存在和编译成功都不能替代用户可见加载证据；
4. installable ZIP/source archive 边界、临时提取物、缓存、私密数据和语言资产
   owner 检查。

无法执行的浏览器、非英语 JSON 可见加载、复杂布局、长文案或发布重放必须标为
`unverified`，不能用 mock 或截图推断完成。
