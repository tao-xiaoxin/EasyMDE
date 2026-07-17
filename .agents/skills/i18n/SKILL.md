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
7. 当前任务实际需要的通用 Skill；
8. react-admin 作为设计思想借鉴，不作为项目权威；
9. 其他博客、搜索摘要、经验贴仅作为辅助输入。

下层资料不得覆盖上层规则；一旦冲突，以上层为准。

## 最小 Companion Skill 组合

不要把 Companion Skill 当成依赖安装列表，也不要为每个 i18n 任务读取全部通用 Skill。只组合当前任务所需的最小集合：

- 普通 EasyMDE React/TypeScript 文案开发：`easymde`；
- legacy owner 转移、双实现接管或旧字段删除：`easymde-migration`；
- 新增或改变可执行逻辑：按风险使用 `test-driven-development`；
- 处理不可信输入、错误详情或隐私边界：按风险使用 `security-and-hardening`；
- 修改 ARIA、表单、焦点或可见交互：按风险使用 `web-design-guidelines`，需要真实浏览器证据时再使用 `browser-testing-with-devtools`；
- 有可测量的渲染、加载或包体积问题：使用 `performance-optimization`。

不要声称读取了当前环境不可访问的 Skill，不要遍历未知 Skill 目录，也不要把本地 Skill 存储路径写入源码、Issue、PR 或公开证据。

## 先验前置：读取真实文件，不猜结论

每次介入 i18n 工作先读取与任务直接相关的实时文件。最低基线是：

- `AGENTS.md`
- `package.json`
- `.agents/skills/easymde/SKILL.md`
- `docs/REACT_DESIGN_PHILOSOPHY.md`
- `scripts/i18n.mjs`
- 待改字符串的 owner、consumer、entrypoint 和相关测试。

涉及 legacy owner 转移时再读取 `.agents/skills/easymde-migration/SKILL.md`；涉及后台或公开前台 Bootstrap 时分别读取 `src/Admin/AdminAssets.php` 或 `src/Frontend/FrontendAssets.php`。不要读取与任务无关的完整目录来制造上下文。

禁止基于“理想架构”宣称功能已实现；所有结论必须来源于当前文件中的事实。

## 当前事实（Current Contract）

以下是当前仓库的真实状态，不能在未改代码前改成“未来能力”：

- **Current（已实现）**

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
  - 后台编辑器当前浏览器文本 owner 是 `AdminAssets::get_strings()` 注入到 `EasyMDEConfig.strings`。
  - 公开文章增强当前浏览器文本 owner 是 `FrontendAssets::enqueue_frontend_assets()` 注入到 `EasyMDEFrontendConfig.strings`。

- **Planned（未来可执行）**

  - React/TypeScript 字符串源与 `@wordpress/i18n` 提取链路；
  - `wp_set_script_translations()` 注册与 JSON 资源交付；
  - 迁移后统一由 React/Feature owner 提供可验证文案。
  - 当前未实现任何 React i18n ownership 转移。
  - 在尚无 React 翻译 owner 时，JavaScript JSON catalog 没有运行时 consumer，仍是计划能力；从第一个 React 翻译 owner 激活开始，WordPress-compatible JSON catalog、加载合同和安装包验证成为强制交付条件。

- **Required before migration（迁移前置）**

  - 在代码层面确认所有迁移字段都来自单一 owner 的 runtime；
  - 提取、校验、发布三个阶段都可复现实地验证；
  - 安装版 ZIP 中可见对应语言资源且可被 WordPress 加载。

- 当前浏览器文本所有权是“PHP bootstrap 注入”：
  - 管理后台：`src/Admin/AdminAssets.php::get_strings()`
    - 通过 `wp_localize_script('easymde-admin', 'EasyMDEConfig', [... 'strings' => $this->get_strings()])`
  - 文章增强前台：`src/Frontend/FrontendAssets.php`
    - 通过 `wp_localize_script('easymde-frontend', 'EasyMDEFrontendConfig', [... 'strings' => [ 'renderingFailed' => ... ]])`
  - 目前仓库不包含 TypeScript/React 消息 JSON catalog 或 Script Module 翻译产物（例如 `languages/*.json`）。
  - 当前最低支持为 WordPress 6.7，因此请以经典脚本 i18n（`wp_set_script_translations()`）路径为实际可行基线，不得将 `wp_set_script_module_translations()` 当作可用完成条件。

### 运行面契约快照（当前）

- 后台编辑器
  - Owner：`AdminAssets`（PHP Gettext `easymde`）；
  - Bootstrap：`EasyMDEConfig.strings`；
  - Script Handle：`easymde-admin`；
  - Locale/方向：WordPress 管理请求上下文；
  - 装载时机：管理后台编辑页加载 `admin_enqueue_scripts`；
  - 关键语言资产：`languages/easymde.pot` / `languages/easymde-zh_CN.po` / `languages/easymde-zh_CN.mo`。
- 公开文章增强
  - Owner：`FrontendAssets`（PHP Gettext `easymde`）；
  - Bootstrap：`EasyMDEFrontendConfig.strings`；
  - Script Handle：`easymde-frontend`；
  - Locale/方向：公开请求上下文（`is_singular`）；
  - 装载时机：`is_singular()` 且 `PostDocument::is_easymde_post()`；
  - 关键语言资产：`languages/easymde.pot` / `languages/easymde-zh_CN.po` / `languages/easymde-zh_CN.mo`。

## 界面边界（后台与公开前台）

- 后台编辑器：使用 WordPress 当前管理请求的语言/方向上下文，owner 是 `AdminAssets`。
- 公开文章增强：使用当前公开请求上下文的语言/方向，owner 是 `FrontendAssets`。
- 二者共享 catalog 与文案 domain，但**不得混用 owner**；
- 后台迁移中的消息删除/新增不能影响 `is_singular()` 下的前台增强渲染。

## 扩展 API 文案所有权

不得把两个公开扩展点写成相同合同：

- **Toolbar Command**
  - `EasyMDE_Plugin::register_toolbar_button()` 进入 `ToolbarRegistry`；
  - `ToolbarRegistry::get_commands_for_script()` 当前对 `label` 和 `description` 调用 `translate( $value, 'easymde' )`；
  - 这是现有兼容行为，不代表仓库已经支持扩展声明或加载自有 text domain。
- **Shortcode Helper**
  - `EasyMDE_Plugin::register_shortcode_helper()` 进入同一 registry；
  - `ToolbarRegistry::get_shortcode_helpers_for_script()` 当前直接传输已注册配置，不自动翻译字段；
  - 不得声称核心会翻译 helper 文案、读取扩展 text-domain descriptor 或加载扩展 catalog。

扩展标识符、command id、shortcut 和配置键不是显示文案。Toolbar 值继续经过现有核心 `easymde` 翻译步骤，浏览器 consumer 将输出视为最终显示值，不再翻译；Shortcode Helper 值保持扩展配置所有权。当前合同没有机制让核心识别并跳过预翻译值，也没有扩展自有 text domain descriptor；任何改变核心 Toolbar 翻译步骤或增加 descriptor 的方案都必须作为独立公共兼容性设计处理，不能在本 Skill 中写成当前能力。

## 所有权模型（必须单一）

同一个用户可见消息实例、交互状态或 Bootstrap field 必须只有一个翻译 owner。

- PHP 页面直接渲染：PHP Gettext（domain `easymde`）；
- 管理后台 legacy UI：`AdminAssets` → `EasyMDEConfig.strings`；
- 文章增强 legacy UI：`FrontendAssets` → `EasyMDEFrontendConfig.strings`；
- 未来 React UI：`@wordpress/i18n` 在已迁移的 React 消息源内；
- 一个消息实例若迁移成功到 React owner，则必须：
  - 在原 bootstrap owner 中删除该条；
  - 在 Issue、PR 或 migration spec 中记录 legacy removal evidence；
  - 保持 release ZIP 与行为回归检测通过。

规则：

- 同一个 Bootstrap field 不得既作为 PHP 已翻译值传入浏览器，又作为 React source message 进入 JS catalog；
- 两套 runtime 不得同时为同一渲染实例或交互状态提供消息；
- 不同 Feature 可以合法拥有相同英文，如 `Save`、`Cancel` 或 `Retry`；
- 不得仅因英文相同就合并 owner 或创建全局消息桶；
- 共享消息必须证明语义、Gettext context、consumer、生命周期和删除策略一致。

## 翻译对象边界

### 应通过可翻译管道的

- 对话框标题、按钮标签、错误/成功状态、提示文案、ARIA/无障碍文本；
- 表单帮助、空状态文案、短提示、工具提示；
- 需要复数处理的数字模板；
- 与人类交流的通知和流程引导文案；
- 包含日期、时间或数字占位符的完整人类语言句子。

### 应按 Locale 格式化但不进入 Gettext 的

- 原始数字、计数和百分比；
- 时间戳、ISO 日期和机器可读时间；
- 已按 WordPress locale 与站点时区格式化的日期、时间和数字值。

消息模板通过 Gettext 或 `@wordpress/i18n` 翻译，格式化值通过 placeholder 插入。发布调度、日期含义和时区换算仍由 WordPress 站点时区权威负责。

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

- 已在关联 Issue、PR 或 migration spec 中明确该 Unit 的验收标准；
- 已记录 owner 转移计划（迁移矩阵）；
- 该 Unit 所有新增/变更字符串由同一个 runtime owner 提供；
- 新 owner 在测试环境下已完成以下能力：
  - 字符串抽取（front-end/TS 源扫描）；
  - 与 PHP catalog 无损并行；
  - 生成并交付 WordPress-compatible JavaScript JSON catalog；
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

### Legacy Bootstrap 维护

在 React 翻译 pipeline 尚未接管对应 Feature 前，不得阻塞现有产品维护：

- legacy-owned Feature 可以维护必要文案，但必须明确 PHP owner、Bootstrap object、field、consumer 和未来移除边界；
- 后台 map 是 `EasyMDEConfig.strings`，公开前台 map 是 `EasyMDEFrontendConfig.strings`，不得只检查其中一个；
- 不得创建无边界的全局字符串集合，也不得把已由 React owner 管理的消息重新加入 Bootstrap；
- 对应运行面的提取、catalog、script translation delivery 和 runtime 已验证后，React-owned 新消息不得继续加入 legacy map；
- ownership 转移完成后，删除对应 Bootstrap field 和 legacy consumer，并保留回滚边界与删除证据。

### 迁移规范模板（每个单元必填）

```text
Feature / behavior:
Runtime surface:
Current PHP translation owner:
Bootstrap object:
Bootstrap field:
Legacy consumers:
Intended React owner:
Source message and context:
Plural/interpolation requirements:
Accessibility use:
Extraction path:
JSON delivery path:
Script handle:
Runtime script source / Manifest entry:
Built runtime path:
JSON filename strategy:
Source-to-build mapping:
Catalog loading evidence:
Activation condition:
Rollback boundary:
Legacy removal evidence:
Release ZIP evidence:
Unverified states:
```

## WordPress 6.7 下的技术边界

### JSON Catalog 激活门槛

- 当前没有 React 翻译 owner，不为 legacy-only Feature 预生成无 consumer 的 JavaScript JSON catalog；
- 从第一个 React 翻译 owner 激活开始，该 owner 的 WordPress-compatible JavaScript JSON catalog、生产加载合同、非英语 locale 运行时证据和安装包证据全部是强制条件；
- 缺失或过期 JSON 是交付故障，不得用 source English、inline fallback 或浏览器 mock 掩盖。

### 经典脚本翻译（当前最小兼容路径）

- React/TypeScript 源码可从 `@wordpress/i18n` 导入 `__`、`_n`、`_x` 和 `sprintf`；
- Classic Script 构建必须将 `@wordpress/i18n` externalize 或映射到 WordPress 提供的 `wp.i18n` runtime；
- 最终注册的生产 Script 必须具备 `wp-i18n` 依赖；依赖 metadata、注册结果与生产 Bundle 都要检查，不能只检查源码 import；
- 不得在生产 Bundle 中同时包含私有 `@wordpress/i18n`、Tannin、重复 locale registry 或第二套 i18n singleton；
- `wp_set_script_translations()` 会在 WordPress 6.7 的注册对象上补充 `wp-i18n` 依赖，但调用成功不证明 Vite externalization、dependency metadata 或 Bundle 内容正确；
- 不得把 React、ReactDOM 或 i18n runtime 的私有副本打包进前端脚本；
- 注册脚本后调用 `wp_set_script_translations( $handle, 'easymde', EASYMDE_PLUGIN_DIR . 'languages' )`；第三个参数是翻译目录的完整文件系统路径；
- 本地化字符串仍遵循 WordPress 权威机制，不是浏览器语言推断；
- 从第一个 React 翻译 owner 激活开始，本地化 JSON 必须参与 ZIP 校验且与当前 domain、locale、Script Handle 或运行脚本路径一致。

### WordPress 6.7 JSON 查找与构建映射

向 `wp_set_script_translations()` 提供翻译目录后，WordPress 6.7 会按顺序尝试：

```text
<domain>-<locale>-<script-handle>.json
<domain>-<locale>-<md5(runtime-relative-script-path)>.json
```

Handle-based 文件的优先级高于 Runtime-path MD5 文件。只要自定义目录中的 Handle 文件成功加载，WordPress 就直接返回，不再尝试同目录中的 MD5 文件；如果自定义目录中的两种候选都不能加载，WordPress 才继续尝试全局语言包目录中的 MD5 文件。因此过期 Handle 文件会遮蔽内容正确的 MD5 文件，不能把两个候选同时存在当作冗余容错。

每个 React Entry 必须明确选择并验证一种自定义目录文件名策略。

#### 所有策略

- Manifest 或等效构建合同必须验证 Source Entry、Built Asset、已注册 Script Handle、Runtime Script URL 和安装包资产之间的对应关系；
- 对于同一个 domain、locale、Script Handle 和运行 Entry，安装版 ZIP 的自定义 Translation Path 正常情况下只包含被选定并验证的一种候选策略；
- 选择 Handle Strategy 时，不遗留同一 Entry 的独立 MD5 候选；选择 MD5 Strategy 时，不遗留会优先匹配的 Handle 候选；
- 迁移期间若暂时同时存在两种候选，必须证明 Jed JSON 内容和 Source Message 集合等价，记录 WordPress 实际加载的文件和旧文件删除边界，并让 Build / Release Check 在两者不一致时失败；
- 不得把长期 Dual Strategy、过期 Handle 文件遮蔽新 MD5 文件或两个独立候选并存定义为可接受的回退机制；
- 不得硬编码某次构建 Hash；缺失、过期、重复或不一致的 mapping 必须失败，而不是静默回退 source English。

#### Handle-based Strategy

目标文件名：

```text
<domain>-<locale>-<registered-script-handle>.json
```

- `wp i18n make-json` 原生不直接生成 Handle-based 文件名；`--use-map` 只改变消息引用对应的路径，输出仍然使用映射后路径的 MD5；
- 选择该策略时，构建必须包含明确、确定且可重现的生成步骤，例如把已验证的 Jed JSON 确定性重命名或复制为 Handle 文件，或使用项目批准并测试过的生成器直接生成 Handle 文件；
- 该步骤必须验证 domain、locale、已注册生产 Script Handle、Jed JSON 内容、Source Message 集合和安装包路径；
- 不得手工维护、手工复制 Handle JSON，也不得把一次临时生成的文件名当作长期合同；
- Handle 重命名后必须删除旧 Handle 文件；构建步骤产生的中间 MD5 文件若会成为同一 Entry 的第二候选，也必须从安装版 ZIP 中排除；
- Manifest 仍用于验证 Source Entry、Built Asset 与 Script Handle 的对应关系，但 Handle 文件名只由稳定的注册 Script Handle 决定，不使用 Runtime Path 或其 MD5 计算。

#### Runtime-path MD5 Strategy

目标文件名：

```text
<domain>-<locale>-<md5(runtime-relative-script-path)>.json
```

- `wp i18n make-json` 默认属于该策略；`wp i18n make-json --use-map` 仍然对映射后的路径取 MD5，不会生成 Handle-based 文件；
- Vite Source Path 必须通过 Manifest 或等效的确定映射转换为最终 Built Runtime Path；
- 使用 `--use-map` 时，映射值必须与 WordPress 6.7 从已注册生产 Script URL 得到并用于 Hash 的生产相对路径完全一致；
- 不得使用 TS/TSX Source Path、本地绝对路径、Dev Server URL、未解析 Manifest Key 或带错误插件目录前缀的路径计算 Hash；
- `.min.js` 必须按 WordPress 6.7 Core 规则先规范为 `.js`，再计算 MD5；
- 不得假设 `frontend/src/entrypoints/admin-editor.tsx`、Manifest Key 与 `assets/build/...js` 产生相同 Hash。

### JSON 生成与 PO 保护

`wp i18n make-json` 的 PO 修改行为依赖所选 WP-CLI i18n-command 版本，未来实现必须固定并验证实际工具版本，不得按记忆假设：

- 官方 `v2.6.6` 实现默认从输入 PO 清除已输出到 JavaScript JSON 的消息，可用 `--no-purge` 保持 PO 不变；
- 官方 `v2.7.0` 起移除了 `--purge`、`--no-purge` 和 `--update-mo-files`，当前 `v2.7.3` 实现保持输入 PO 不变；
- 未来 pipeline 必须记录明确的 PO mutation/purge policy，并通过 fixture 证明所选版本的真实行为；
- 如果所选工具版本或替代工具可能修改 PO，使用该版本支持的 no-purge 模式、受控临时副本，或经过验证且同步更新 PO/MO 的确定流程；不在本 Skill 中预设其中一种；
- JSON 生成前后都运行现有 `npm run i18n:check` 以及届时新增的 TS/TSX catalog 校验；
- 比较 POT、PO、MO 与 JSON，证明 PHP-owned 消息没有丢失、JavaScript 消息进入正确 catalog、共享 source message 不受生成顺序破坏，并且维护的 `zh_CN` 继续满足项目完整性合同；
- 不得在开发者工作区原地破坏维护中的 PO，再用 Git 回滚掩盖 pipeline 缺陷。

### Lazy Chunk 与可选 Feature

- 不能假设 Entry 的 JSON 自动覆盖所有独立构建 Chunk；
- 含可翻译消息的 Chunk 必须有经过 WordPress 6.7 实际运行时验证的交付方式；
- 可接受方式包括在 Entry 执行前加载消息数据、为 Chunk 提供独立稳定 Script Handle 与 catalog，或其他经真实运行时验证的方案；
- 没有明确合同前，不把用户文案拆进无法注册或加载翻译的动态 Chunk；
- 不为此预建新的 Chunk Loader，也不把所有消息集中进全局 `messages.ts`。

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

/* translators: %s: formatted revision count. */
const countLabel = sprintf(
  _n( '%s revision', '%s revisions', count, 'easymde' ),
  formattedCount,
);

const panelTitle = _x( 'Preview', 'editor panel title', 'easymde' );
```

- 不引入自建 i18n Provider；
- 消息 ID 与 context 使用字面量；
- `_n()` 使用原始数值选择复数，显示参数使用 locale-aware 的格式化值；
- placeholder 的数量、顺序和类型必须与参数一致；
- placeholder、count 或歧义术语使用可被所选 TS/TSX 提取工具识别的 `translators:` 注释，并实际验证注释进入 catalog；
- 不允许模板字符串拼接可翻译句子；
- 不允许将 translated text 作为 key/id/selector/storage 键；
- 不允许为默认 WordPress locale 再做一套 runtime provider；
- 不允许将翻译结果放入 Root Store、Post Meta、Options、Local Storage 或 Recovery Draft；
- 持久化稳定数据，不持久化当前 locale 的显示结果；
- 若未通过提取与发布校验，不得用 React 自定义 inline English fallback 掩盖合同故障。

### Feature-owned Messages

- 文案属于拥有交互和渲染实例的 Feature 或 Component；
- 不创建全局 `messages.ts`，不创建无边界的 `common` 消息桶；
- 不因英文相同就共享消息；
- 只有多个稳定 consumer 已证明语义、context、生命周期和删除策略一致时，才考虑窄范围共享；
- shared formatting helper 只负责格式化数据，不因此成为 shared message owner；
- 翻译尽可能靠近渲染处发生；Store 保存稳定状态和原始数据，不保存当前 locale 的翻译结果；
- 可选或 lazy Feature 必须验证其消息 chunk、script handle 与 catalog 在激活时可用，不得把消息预先集中到全局文件来规避交付问题。

## Source English 与合同故障

返回 source English 不必然是错误。以下情况合法：

- 当前 locale 就是 source locale；
- 社区 catalog 没有对应翻译；
- WordPress 按 Gettext 语义返回原始 msgid。

以下情况是必须可观察并修复的合同故障：

- 项目维护并声明完整的非英语 locale 本应包含该消息，但提取遗漏；
- 声明随包交付的 catalog 或 JSON 资源缺失、损坏或无法加载；
- text domain、script handle、资源路径或加载顺序错误；
- 必需 Bootstrap field 缺失；
- React 自定义 fallback 掩盖了上述故障。

不要让 source-locale 页面崩溃或显示空白。Fail Fast 针对项目声明的提取、交付和 owner 合同，不针对 Gettext 的正常 source fallback。

## 与 react-admin 的借鉴边界

可吸收：

- 对 string inventory 的系统性清点；
- 通常优先使用插值而不是拼接；
- 合理使用复数规则；
- 关注通知、错误、提示、空状态和访问性文案；
- 依赖官方验证路径（而非自定义字符串包）。

不可照搬：

- 任何 `i18nProvider`、语言切换器、全局 locale 检测流程；
- Polyglot、`||||` 复数语法或 Language Packs；
- 业务与扩展名空间机制（`ra.*`、`resources.*` 等）；
- 浏览器 locale 自动驱动 WordPress 插件；
- 反向兼容性以“框架约定”取代 WordPress 版本边界。

## 设计与质量规范（与 issue80 i18n 目标关联）

- 命名和参数要稳定：`label`, `title`, `helpText`, `errorText`, `emptyStateText`；
- 同一 feature 内按语义聚合字符串；不要将不同上下文复用同一个字段；
- 模拟值（demo）与真实数据值需分离；
- 代码结构上尽量沿 `docs/REACT_DESIGN_PHILOSOPHY.md` 与 `.agents/skills/easymde/SKILL.md` 的 owner、Port、Feature 组织；
- 一律避免为了规避翻译问题新增无关依赖（除非 issue 明确要求）。

## 格式、RTL、日期与数字

- 使用 WordPress locale；不得从浏览器 `navigator` 决定 locale；
- `is_rtl()` / `isRTL()` 决定方向；
- PHP 使用 `number_format_i18n()`、`wp_date()`；JS 使用与 WordPress locale 数据和项目依赖一致的等价能力；
- 不要在翻译前后混入布局相关断言（如“按钮固定长度”）；
- 格式化结果不是 msgid；包含结果的完整句子使用 placeholder：

```ts
const message = sprintf(
  __( 'Last saved at %s', 'easymde' ),
  formattedTime,
);
```

- `formattedTime` 服从 WordPress locale 与站点时区，本身不进入 Gettext。

## 无障碍文本

无障碍文本按同一 ownership 规则翻译：图标按钮 label、dialog label、状态播报、提示、快捷键说明、表单关系文本。

- 可访问名必须是最终翻译文案，不是内部字段名；
- 不将动态 id/control 参数翻译；
- 若 React owner 使用 ARIA，需要通过可访问性验证而非文案检查“通过”。

## 构建与发布产物边界

产物类型必须分开验证：

- **Installable plugin ZIP**
  - 排除 `.agents/`、frontend source、测试、缓存、日志、开发工具、临时提取文件和未批准的 source map；
  - 包含运行所需的 PHP、编译后 JavaScript/CSS、运行时依赖、license/notice、当前 POT/PO/MO，以及从第一个 React 翻译 owner 激活开始所需的 JSON catalog；
  - 必须验证脚本句柄、text domain、文件名和资源路径与包内文件一致。
- **Source ZIP / source tar.gz**
  - 可以包含受控且已跟踪的项目源码和维护文件；
  - 公开源码归档不是“源码泄漏”，但仍不得包含未跟踪临时文件、秘密或私密运行数据。

不得以单一 i18n 任务临时破坏现有 release 与 source archive 的职责边界。

## 隐私与诊断边界

Gettext source message、translator comment、代码示例、测试 fixture、catalog、公开 Issue/PR 证据、日志和诊断上下文都不得包含：

- 本地绝对路径、用户名、home directory 或机器名；
- token、cookie、nonce、credential、API key 或私有 endpoint；
- 真实文章标题、Markdown、摘要、AI prompt/输出或 custom CSS；
- 真实邮箱、私有媒体 URL、私有文件名、原始环境变量或含用户数据的 CI artifact；
- 未清理的 stack trace 或可识别个人与运行环境的信息。

示例与 fixture 使用合成数据。Translator comment 只解释占位符、语义和 context，不复制真实用户内容。诊断信息分层：

- stable error code 与 operation ID：不翻译；
- technical context：不翻译，结构化、最小化且移除隐私；
- user-facing message：由当前渲染 owner 翻译，不附带原始敏感详情。

## 验收与风险清单（Issue 对齐）

### 首个 React i18n 迁移单元的强制证据

这些是未来首个 React 翻译 owner 的完成条件，不是当前文档 PR 已执行的 runtime 验证。

**Build evidence**

- 生产 Bundle 不包含私有 `@wordpress/i18n`、Tannin 或重复 locale registry；
- 最终生产 Script 具有正确 `wp-i18n` 依赖；
- Vite Manifest 指向的 built runtime path 与 JSON filename strategy、source-to-build mapping 一致；
- 生产 mapping 不包含 Localhost、Dev Server URL、本地绝对路径、TS/TSX source path 或未解析 Manifest key。

**Catalog evidence**

- 记录 JSON filename strategy、source-to-build mapping 和实际加载文件；
- 固定并记录 WP-CLI i18n-command 或替代工具版本及 PO mutation/purge policy；
- JSON generation 可重复，缺失或过期 mapping 会失败；
- POT/PO/MO 没有被意外破坏，维护的 `zh_CN` 仍满足完整性要求；
- `npm run i18n:check` 与新增的 TS/TSX catalog 检查通过。

**Filename strategy evidence**

- 为每个运行 Entry 明确选择 Handle-based 或 Runtime-path MD5 Strategy；
- 记录 WordPress 在维护的非英语 locale 下实际加载的 JSON 文件；
- 检查自定义 Translation Path 中是否存在会优先匹配并遮蔽所选策略的旧 Handle 文件；
- 安装版 ZIP 不包含会遮蔽所选策略的过期候选文件，也不把两个独立候选当作冗余容错；
- Handle Strategy 的生成步骤确定、可重现且不依赖人工复制，并验证对应 Entry / Chunk 的消息集合；
- MD5 Strategy 的 Hash 输入与 WordPress 6.7 实际使用的 Runtime-relative Script Path 及 `.min.js` 规范化结果完全一致。

**Filename precedence negative-test contract**

首个 React 翻译 owner 必须增加一个未来负向 Fixture：在同一自定义 Translation Path 中同时放入过期 Handle JSON 和内容正确的 MD5 JSON，证明 WordPress 6.7 会优先加载 Handle JSON，并证明 Release Validation 会拒绝两者不一致的安装包状态。该测试是未来实现合同，不是当前文档 PR 已执行的运行时测试。

**Runtime evidence**

- 在维护的非英语 locale 下安装并运行 installable plugin ZIP；
- 证明 WordPress 实际加载了对应 JSON，显示翻译来自 JSON 而不是浏览器 mock 或 source-English fallback；
- 错误 Handle、错误 mapping 和缺失 JSON 都有失败测试。

**Package evidence**

- 必需 JSON 存在于 installable plugin ZIP；
- JSON filename、domain、locale、Handle 或 runtime-relative script path 完全匹配；
- Source archive 与 installable plugin ZIP 继续按各自合同独立验证。

### 必检点（静态）

- 变更字符串全部在单一 owner；
- `i18n` 关键词、context、复数逻辑正确；
- 没有用变量构造 msgid；
- 涉及 ownership 转移时，已经存在旧 owner → 新 owner 的迁移单元清单；
- `scripts/i18n.mjs` 覆盖了真实变更源（按当前范围）；
- `npm run i18n:check` 在变更前后通过（若变更涉及 catalogs）。

### 必检点（运行时）

- 非默认 locale 入口可见真实加载（非模拟）；
- 错误/状态文案在 user-facing 面展示正确；
- 无重复 owner 迹象（同一消息实例没有同时来自 `EasyMDEConfig.strings`、`EasyMDEFrontendConfig.strings` 和 React owner）；
- RTL 与方向检测由 WordPress 提供；
- 不泄漏用户内容作翻译上下文。

### 必检点（发布）

- 安装 ZIP 包含目标 locale 文件；
- installable plugin ZIP 排除开发源码和临时产物，source archive 只包含受控且已跟踪的公开源码；
- 变更未触发未授权的远端资源加载；
- 新增/迁移文案不会影响未迁移的 legacy 页面。

### 典型失败风险（需逐条记录）

1. 双重翻译 owner（PHP + React 同文案）导致文本乱跳；
2. 声明完整的维护 locale 因提取或交付故障意外回退 source English；
3. TS 抽取未覆盖新源导致语言包缺失；
4. `wp_set_script_translations` 调用时机错误导致页面空文案；
5. 新增文案在 release ZIP 中缺失导致 production fallback。

### 未验证与失败边界（每次迁移需补齐）

- 非英语 locale 下特定 Feature/entry 的真实可见性；
- 长文本、复杂布局和高对比度下文案回退行为；
- 真实发布 ZIP 重放后的 locale 与方向读取行为；
- 组件未接入 catalog 时的 fail-fast 与错误上报可观测性。

### 反方审查（每次迁移必须回答）

迁移前后检查下面问题是否可被回答且有证据：

1. 我能否区分当前事实和计划能力？
2. 我是否明确知道当前是哪一个 owner 负责该文案？
3. 一条字符串是否可能在 PHP bootstrap 与 React owner 两端同时存在？
4. 迁移失败时是否有回退路径和未翻译文案的可观测证据？
5. 安装包是否真正包含该语言资产，CI/运行时证据是否可重放？
6. 前台增强页与后台编辑页的 locale 边界是否有显式避免互相串用？
7. 扩展命令/工具的文案是否保持它们的扩展所有权？
8. Source English 是当前 locale 的正常结果，还是维护 catalog 的提取或交付故障？
9. Translator comment、fixture 和诊断证据是否只含合成或已清理数据？

未能回答任一项则不允许提交或转交。

## 禁止模式（Prohibited）

- 平台 locale 切换器；
- 浏览器 locale 决定 WordPress 权限/翻译；
- 动态拼接作为 msgid；
- 同时保留 PHP/React 双 owner 并且不写清移除计划；
- `wp_set_script_module_translations()` 在当前最小版本下作为已实现状态；
- 不完整的“预览通过”而不跑 i18n/release 检查；
- 用 React inline English fallback 掩盖缺失提取、catalog 或 delivery 故障；
- 未声明 rollback boundary 即启动迁移；
- 创建第二套消息源或未声明的 catalog 运行线。

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
https://github.com/WordPress/wordpress-develop/blob/6.7/src/wp-includes/l10n.php#L1142-L1269
https://github.com/WordPress/wordpress-develop/blob/6.7/src/wp-includes/class-wp-scripts.php#L652-L708
https://developer.wordpress.org/cli/commands/i18n/make-json/
https://github.com/wp-cli/i18n-command/blob/v2.6.6/src/MakeJsonCommand.php
https://github.com/wp-cli/i18n-command/blob/v2.7.3/src/MakeJsonCommand.php
```

React-admin 参考仅限其项目组织思想，不作为翻译实现权威。
