---
name: easymde-i18n
description: Use this skill when adding, changing, migrating, reviewing, or validating EasyMDE user-facing strings, PHP Gettext calls, legacy browser bootstrap strings, React/TypeScript translations, locale-aware formatting, RTL behavior, translation catalog/build pipeline, and release-package language assets.
---

# EasyMDE React-Focused i18n Skill

这个 skill 的目标是：指导 EasyMDE 在保持 WordPress 权威模型不变前提下，把现有浏览器字符串逐步迁移到 React/TypeScript，并保证翻译链路可迁移、可验证、可回滚。

**它不是 WordPress i18n 通用入门手册，也不替代 `AGENTS.md`、`.agents/skills/easymde/SKILL.md`、`.agents/skills/easymde-migration/SKILL.md` 或 `docs/REACT_DESIGN_PHILOSOPHY.md`。**

## 规则优先级（执行顺序）

1. 当前任务、关联 Issue、维护者决策；
2. 根目录 `AGENTS.md` 与实时仓库；
3. `docs/ARCHITECTURE.md`、`docs/REACT_DESIGN_PHILOSOPHY.md`；
4. `.agents/skills/easymde/SKILL.md`；
5. `.agents/skills/easymde-migration/SKILL.md`（当涉及所有权转移）；
6. 官方文档（按当前支持版本）；
7. 参考型技能：`spec-driven-development`、`deprecation-and-migration`、`frontend-ui-engineering`、`test-driven-development`、`browser-testing-with-devtools`、`security-and-hardening`、`wp-plugin-development`、`performance-optimization`、`code-review-and-quality`、`react-best-practices`、`composition-patterns`、`web-design-guidelines`；
8. react-admin 作为设计思想借鉴，不作为项目权威；
9. 其他博客、搜索摘要、经验贴仅作为辅助输入。

下层资料不得覆盖上层规则；一旦冲突，以上层为准。

## 先验前置：读取真实文件，不猜结论

每次介入 i18n 工作前必须读取至少这些文件：

- `AGENTS.md`
- `package.json`
- `.agents/skills/easymde/SKILL.md`
- `.agents/skills/easymde-migration/SKILL.md`
- `docs/REACT_DESIGN_PHILOSOPHY.md`
- `scripts/i18n.mjs`
- `src/Admin/AdminAssets.php`
- `src/Frontend/FrontendAssets.php`
- 相关模板与测试文件（包含待改字符串所在目录）

禁止基于“理想架构”宣称功能已实现；所有结论必须来源于当前文件中的事实。

## 当前事实（Current Contract）

以下是当前仓库的真实状态，不能在未改代码前改成“未来能力”：

- 文本域是 `easymde`。
- 插件头定义 `Domain Path: /languages`（以当前源码为准）。
- i18n 生成是 `scripts/i18n.mjs` 管理的 PHP-only 流程。
- `scripts/i18n.mjs` 当前扫描 `easymde.php`、`includes`、`src`、`templates`（PHP 文件）。
- npm 命令是：
  - `i18n:make-pot`
  - `i18n:compile`
  - `i18n:check`
- 活跃语言产物是：
  - `languages/easymde.pot`
  - `languages/easymde-zh_CN.po`
  - `languages/easymde-zh_CN.mo`
- 当前浏览器文本所有权是“PHP bootstrap 注入”：
  - 管理后台：`src/Admin/AdminAssets.php::get_strings()`
    - 通过 `wp_localize_script('easymde-admin', 'EasyMDEConfig', [... 'strings' => $this->get_strings()])`
  - 文章增强前台：`src/Frontend/FrontendAssets.php`
    - 通过 `wp_localize_script('easymde-frontend', 'EasyMDEFrontendConfig', [... 'strings' => [ 'renderingFailed' => ... ]])`
- 目前仓库不包含 TypeScript/React 消息 JSON catalog 或 Script Module 翻译产物（例如 `languages/*.json`）；
- 当前最低支持为 WordPress 6.7，因此请以经典脚本 i18n（`wp_set_script_translations()`）路径为实际可行基线，不得将 `wp_set_script_module_translations()` 当作可用完成条件。

## 所有权模型（必须单一）

同一个可见字符串必须只有一个“渲染所有者”。

- PHP 页面直接渲染：PHP Gettext（domain `easymde`）；
- 管理后台 legacy UI：`AdminAssets` → `EasyMDEConfig.strings`；
- 文章增强 legacy UI：`FrontendAssets` → `EasyMDEFrontendConfig.strings`；
- 未来 React UI：`@wordpress/i18n` 在已迁移的 React 消息源内；
- 一条消息若迁移成功到 React owner，则必须：
  - 在原 bootstrap owner 中删除该条；
  - 在迁移文档中标记“legacy removable”并通过验证；
  - 保持 release ZIP 与行为回归检测通过。

规则：

- 不允许“同一英文含义在 PHP 与 React 同时翻译”；
- 不允许两套 runtime 同时提供同一文案。

## 翻译对象边界

### 应通过可翻译管道的

- 对话框标题、按钮标签、错误/成功状态、提示文案、ARIA/无障碍文本；
- 表单帮助、空状态文案、短提示、工具提示；
- 需要复数处理的数字模板；
- 与人类交流的通知和流程引导文案；
- 日期/数字格式化结果（WordPress 规范下）。

### 禁止翻译（稳定标识/用户数据）

- 用户文章内容（标题、正文、摘要、标签名、分类名）；
- REST 路由、参数名、HTTP 状态码、错误码、数据库 meta key、option 名称、command id；
- script handle、class/id、HTML 属性名、选择器、存储键；
- 纯技术数据（模型 ID、provider ID、令牌/敏感日志字段）；
- Markdown 源码、CSS、正则、Shell 命令。

## 从 PHP Gettext 到 React i18n 的迁移策略

这类迁移必须是“单一功能单元”而非一次性全局替换。

每个迁移单元必须先写清：

- 行为边界（按钮、面板、弹窗、状态文案之一）；
- 当前 owner、目标 owner；
- 预期输出、失败路径、取消路径；
- 迁移完成条件（移除旧 Bootstrap 字段、无双重翻译）。

### 迁移可接受前置条件

- 已在该 Unit 使用 `spec-driven-development` 明确验收标准；
- 已在 Issue 中记录 owner 转移计划（迁移矩阵）；
- 该 Unit 所有新增/变更字符串由同一个 runtime owner 提供；
- 新 owner 在测试环境下已完成以下能力：
  - 字符串抽取（front-end/TS 源扫描）；
  - 与 PHP catalog 无损并行；
  - 发布 JSON（如采用）与脚本句柄注册；
  - `wp_set_script_translations()` 加载验证；
  - 安装 ZIP 中可见对应语言资源；
  - Lazy/代码分片场景下消息可用。

### 迁移执行顺序（每个单元）

1. 在 PHP owner 与消费者之间建立字符串契约清单（`key / source text / translator context / 是否复数`）；
2. 在新 owner 的源代码里引入 `@wordpress/i18n` 翻译；
3. 先补齐 extraction/validation 能力，再迁移逻辑；
4. 在 PR 内确认旧 owner 已不再消费该文案；
5. 通过 runtime 验证（非浏览器文案 mock）；
6. 移除旧 Bootstrap 字段；
7. 重新跑相关 i18n 与 release 校验；
8. 仅当单元验证通过后再进入下一个单元。

禁止把“新增翻译 helper”当成迁移完成条件；迁移完成以 `单元 owner + release + 运行时` 同步通过为准。

## WordPress 6.7 下的技术边界

### 经典脚本翻译（当前最小兼容路径）

- i18n 包依赖必须有 `wp-i18n`；
- 不得把 React 运行时打包进前端脚本；
- 注册脚本后调用 `wp_set_script_translations( $handle, 'easymde', EASYMDE_ROOT . '/languages' )`；
- 本地化字符串仍遵循 WordPress 权威机制，不是浏览器语言推断；
- 本地化 JSON（若引入）必须参与 ZIP 校验且与当前域、版本一致。

### Script Module 翻译

- 当前 WordPress 6.7 项目不把 Script Module 翻译 API 作为完成条件；
- 不得因为浏览器可运行 demo 就宣称模块翻译就绪；
- 若未来升级最小版本，需开新 Issue 复核 API 与兼容性后再改。

## PHP/Gettext 规则（现状强制）

仅以下场景使用 PHP Gettext（直到对应 UI ownership 真正迁移）：

- 字符串在 PHP 渲染或 legacy bootstrap 时；
- `__()/_e()`：普通字符串；
- `_x()`：语义歧义词；
- `_n()/_nx()`：计数变化；
- `esc_html__()/esc_attr__()`：上下文输出前转义；
- 不允许变量/动态拼接作为 msgid；
- 有歧义、占位符、历史术语的必须加 `translators:` 注释；
- 计数文本先 `_n` 再 `number_format_i18n()`；
- 不得提前在文件作用域初始化翻译字符串（避免加载顺序问题）。

示例（单复数）：

```php
$count_label = sprintf(
    /* translators: %1$s: revision count in current locale. */
    _n( '%1$s revision', '%1$s revisions', $count, 'easymde' ),
    number_format_i18n( $count )
);
```

## React / TypeScript 规则（迁移后的目标 owner）

当一个字符串已转到 React owner 并且提取链路完备时：

```ts
import { __, _n, _x, sprintf } from '@wordpress/i18n';

const title = __( 'Live preview', 'easymde' );
const count = sprintf(
  _n( '%1$s revision', '%1$s revisions', revisionCount, 'easymde' ),
  revisionCount
);
```

- 不引入自建 i18n Provider；
- 消息 ID 与 context 使用字面量；
- 不允许模板字符串拼接可翻译句子；
- 不允许将 translated text 作为 key/id/selector/storage 键；
- 不允许为默认 WordPress locale 再做一套 runtime provider；
- 新 owner 就绪前不得扩充 `EasyMDEConfig.strings`；
- 若未通过提取与发布校验，不得以英文默认值掩盖缺失翻译状态（fail fast）。

## 与 react-admin 的借鉴边界

可吸收：

- 对 string inventory 的系统性清点；
- 通常优先使用插值而不是拼接；
- 合理使用复数规则；
- 关注通知、错误、提示、空状态和访问性文案；
- 依赖官方验证路径（而非自定义字符串包）。

不可照搬：

- 任何 `i18nProvider`、语言切换器、全局 locale 检测流程；
- 业务与扩展名空间机制（`ra.*`、`resource.*` 等）；
- 浏览器 locale 自动驱动 WordPress 插件；
- 反向兼容性以“框架约定”取代 WordPress 版本边界。

## 设计与质量规范（与 issue80 i18n 目标关联）

- 命名和参数要稳定：`label`, `title`, `helpText`, `errorText`, `emptyStateText`；
- 同一 feature 内按语义聚合字符串；不要将不同上下文复用同一个字段；
- 模拟值（demo）与真实数据值需分离；
- 同一 feature 的翻译字段建议有生命周期说明（开发中/生产中/迁移后禁用）。
- 代码结构上尽量沿 `docs/REACT_DESIGN_PHILOSOPHY.md` 与 `.agents/skills/easymde/SKILL.md` 的 owner、Port、Feature 组织；
- 一律避免为了规避翻译问题新增无关依赖（除非 issue 明确要求）。

## 格式、RTL、日期与数字

- 使用 WordPress locale；不得从浏览器 `navigator` 决定 locale；
- `is_rtl()` / `isRTL()` 决定方向；
- `number_format_i18n()`、`wp_date()`（或对应 JS 等价）；
- 不要在翻译前后混入布局相关断言（如“按钮固定长度”）；
- 日期/数字翻译优先与 WordPress 站点配置一致。

## 无障碍文本

无障碍文本按同一 ownership 规则翻译：图标按钮 label、dialog label、状态播报、提示、快捷键说明、表单关系文本。

- 可访问名必须是最终翻译文案，不是内部字段名；
- 不将动态 id/control 参数翻译；
- 若 React owner 使用 ARIA，需要通过可访问性验证而非文案检查“通过”。

## 目录级构建与发布规则（不变）

- 开发文件不进入可安装 ZIP；
- `Node` 依赖、源文件、`source maps`、测试产物、日志、缓存、`.agents/` 不应进入安装产物；
- 安装包必须包含运行所需的翻译文件（当前是 `.po/.mo`，未来如有 JSON 按新职责纳入）；
- 发布/源码归档与现有 release 流程一致，不得以单一 i18n 目的临时改动打断打包边界。

## 验收与风险清单（Issue 对齐）

### 必检点（静态）

- 变更字符串全部在单一 owner；
- `i18n` 关键词、context、复数逻辑正确；
- 没有用变量构造 msgid；
- 已经存在旧 owner → 新 owner 的迁移单元清单；
- `scripts/i18n.mjs` 覆盖了真实变更源（按当前范围）；
- `npm run i18n:check` 在变更前后通过（若变更涉及 catalogs）。

### 必检点（运行时）

- 非默认 locale 入口可见真实加载（非模拟）；
- 错误/状态文案在 user-facing 面展示正确；
- 无重复 owner 迹象（同 key 同时在 `EasyMDEConfig.strings` 与 React owner）；
- RTL 与方向检测由 WordPress 提供；
- 不泄漏用户内容作翻译上下文。

### 必检点（发布）

- 安装 ZIP 包含目标 locale 文件；
- release artifact 不泄漏源码；
- 变更未触发未授权的远端资源加载；
- 新增/迁移文案不会影响未迁移的 legacy 页面。

### 典型失败风险（需逐条记录）

1. 双重翻译 owner（PHP + React 同文案）导致文本乱跳；
2. 新 owner 渲染了 msgid（英文 fallback 被误当成成功）；
3. TS 抽取未覆盖新源导致语言包缺失；
4. `wp_set_script_translations` 调用时机错误导致页面空文案；
5. 新增文案在 release ZIP 中缺失导致 production fallback。

## 禁止模式（Prohibited）

- 平台 locale 切换器；
- 浏览器 locale 决定 WordPress 权限/翻译；
- 动态拼接作为 msgid；
- 同时保留 PHP/React 双 owner 并且不写清移除计划；
- `wp_set_script_module_translations()` 在当前最小版本下作为已实现状态；
- 不完整的“预览通过”而不跑 i18n/release 检查；
- 用 inline English 兜底掩盖缺失提取或 catalog 缺失。

## 官方参考（版本对齐）

以下官方入口优先于博客/示例（按 WP/React 实际版本核对）：

```text
https://developer.wordpress.org/plugins/internationalization/
https://developer.wordpress.org/plugins/internationalization/how-to-internationalize-your-plugin/
https://developer.wordpress.org/apis/internationalization/
https://developer.wordpress.org/block-editor/reference-guides/packages/packages-i18n/
https://developer.wordpress.org/block-editor/reference-guides/packages/packages-date/
https://developer.wordpress.org/reference/functions/wp_set_script_translations/
https://make.wordpress.org/core/2024/10/21/i18n-improvements-6-7/
```

React-admin 参考仅限其项目组织思想，不作为翻译实现权威。
