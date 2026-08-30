# EasyMDE React 设计哲学

本文记录 EasyMDE 后台 React、TypeScript 与 Vite 应用的长期设计理由和稳定目标边界。
它只回答 EasyMDE 为什么这样划分责任，以及哪些边界不能被短期实现取代；不承担当前实现清单、浏览器执行合同、测试步骤或发布清单。

权威路由如下：

- 当前已经落地的 PHP、React、入口、Manifest 与服务边界：[Architecture](ARCHITECTURE.md)。
- React/浏览器的可执行实现合同、owner 清点、删除证明与包影响：`.agents/skills/easymde/SKILL.md` 及其 `references/`。
- 测试、CI、安装版 ZIP、Source Archive 与 E2E 步骤：[Testing and Release](TESTING_AND_RELEASE.md)。
- PHP/React 文案 owner、提取、Catalog、Locale、RTL 与语言资产：`.agents/skills/i18n/SKILL.md`。
- WeChat 决策、替代方案与后果：[ADR-001](decisions/ADR-001-wechat-clipboard-serialization.md)。

当本文与代码或当前任务冲突时，以当前人工决定、`AGENTS.md`、实时仓库和已承诺的公共兼容合同为准；不要把目标描述误读为当前实现证据。

## 一、产品边界

EasyMDE 是 WordPress Markdown 编辑器，不是新的 CMS、权限系统、渲染后端或发布平台。
React 只负责后台呈现、交互编排和编辑会话中的浏览器状态。
PHP 与 WordPress 继续拥有：

- 支持的 Post Type 准入、Capability、Nonce、认证、锁和站点时区；
- Post Meta、Options、Autosave、Revision、Media、Taxonomy、Status、Save 和 Publish；
- 正式 Markdown 渲染、HTML 清洗、公开内容、Feed、Search 与兼容输出；
- Article Theme、Code Theme、Custom CSS 与公共扩展 Registry。

`_easymde_markdown` 是唯一 Markdown 来源，`post_content` 是安全渲染的 WordPress 兼容 HTML，`post_title` 仍由 WordPress 持久化。
打开普通支持文章保持零写入；没有 Markdown 时由现有 PHP Migration owner 在内存中导入 HTML，下一次合法保存才建立新的文档状态。
React 不建立第二正式 Renderer、Save、Publish、Revision、Media、Settings、Permission、Timezone 或 Public Content authority。

WordPress 编辑表单是开放兼容界面。
React 只同步明确委托的原生字段，不能用封闭的 TypeScript 字段表重建提交，也不能丢弃 Meta Box 或扩展字段。
同步到隐藏字段只是 Submission Bridge，不是持久化成功信号。

## 二、普通编辑器与 Root

普通 WordPress Editor 的目标是一个 React Editor Root，覆盖历史编辑器所需的编辑、Preview、Appearance、Fonts、Custom CSS、Media、Local Draft、WeChat 和固定 Source/Preview workspace 能力。
Root 可以由多个聚焦 Feature 组合，但每个外部责任只有一个 owner。

Focus Mode / 沉浸式写作不属于普通编辑器默认表面。
Issue #126 允许在同一 Root 内打开沉浸式呈现；它复用普通编辑器的文档、Preview、原生表单、媒体、修订和 WordPress session owner，不创建第二 Root、编辑器、Renderer、保存链路或持久化模型。
沉浸式界面的 Publish、History、Outline、统计和视图交互只能作为现有 WordPress 能力的临时投影；最终提交和恢复回到其原生 owner。

Settings Center 是独立的 React Root，因为它是独立的 WordPress 管理屏幕。
它与 Editor Root 不共享可变 Store、Context、缓存或生命周期 owner。
普通编辑器和 Settings Center 都必须使用 WordPress 提供的 React 18 runtime，但不能借此引入另一个 React runtime、后台 SPA、Router 或 Hydration 模型。

Root 的存在不是资源准入条件。
PHP 先按后台 Screen、Supported Post Type、Capability 和实际资源合同决定是否输出入口；入口再校验 Bootstrap、DOM、WordPress runtime 与 Manifest。
Mount/Unmount、失败、取消、重复进入和 teardown 必须释放各自的监听器、Observer、Timer、临时 DOM、焦点、滚动、锁和异步工作。

## 三、Feature、Port 与 Adapter

代码按用户可识别的能力划分，例如 `markdown-editor`、`live-preview`、`toolbar`、`appearance`、`custom-css`、`media`、`local-drafts`、`wechat-export` 和 `ai-assistant`。
只有出现真实消费者时才创建 Feature 目录、Store、Provider、Port、Adapter 或共享 Primitive；不为理想终态创建空路径、占位模块或通用杂物箱。

- Feature 表达完整用户能力，并拥有自己的局部状态、事件和失败呈现。
- Domain 只放与 React、DOM、WordPress、网络和 Storage 无关的纯规则。
- Port 表达一个稳定的外部能力、结果、失败和取消边界。
- Adapter 连接 WordPress、REST、DOM、Media、Storage 或 Clipboard，并在边界负责解析、授权错误映射、取消、过期结果和清理。
- Runtime 只组装当前 Root 真正拥有的 capability slices；不声明万能 `EditorAdapter`、`WordPressService` 或 `execute(type, payload)`。

Feature 不直接读取 WordPress global、Bootstrap、REST client、Storage、Clipboard 或 DOM selector，也不构造具体 Adapter。
入口负责组装真实 Runtime；跨 Feature 只能依赖窄的公共 API，并保持依赖方向无环。
选择新组件或依赖前，先检查已有 EasyMDE/WordPress 能力和原生语义控件；只有已验证的交互责任无法由它们承担时，才引入最小的可维护实现。

## 四、状态与操作权威

持久化状态属于 PHP/WordPress，服务端派生状态由一个明确 owner 管理，编辑会话状态由最近的 Feature 或 Root（确实需要跨 Feature 协调时）管理。
派生的 Dirty、统计和能力状态不复制成独立真相；Recovery data 只进入版本化、按 Site/User/Post 隔离的 Local Draft Store，并且永远不是文章保存的隐式替代品。

Preview 是唯一正式 Safe HTML sink：Markdown 经 `PreviewPort` 交给 PHP `EasyMDE\Content\MarkdownRenderer`，返回的已清洗 HTML 再由本地 Mermaid、KaTeX、Highlight.js 和 TOC enhancement 增强。
浏览器不再渲染另一份 Markdown，也不以近似结果掩盖 PHP Renderer 或 Composer 依赖失败。

Save、Publish、Restore、Upload、Settings、Custom CSS 和 Clipboard 都必须由明确用户动作启动，等待真实 WordPress 或浏览器 owner 的结果，再更新界面状态。
打开、关闭、Focus、Preview、取消、fallback 和 teardown 不得隐藏写入；Browser Abort 也不能被解释成服务端 Mutation 已取消。

每项异步能力都要绑定当前 Site/User/Post/Root/Feature identity，并明确 latest-wins、single-flight、parallel-keyed 或 ordered 语义。
旧请求、关闭的 Dialog、已替换的 Surface 和已卸载的 Root 不能改变当前状态。
预期失败进入稳定 Error Code 和可见状态，诊断只记录隐私安全的最小上下文。

## 五、公共兼容与主题边界

EasyMDE 保留现有公共 Facade、Filters、Actions、REST namespace、Theme ID、Command ID、Script Handle、ordering、collision 和 failure behavior。
尤其包括：

```text
EasyMDE_Plugin::register_toolbar_button()
EasyMDE_Plugin::register_shortcode_helper()
easymde_supported_post_types
easymde_article_themes
easymde_code_themes
easymde_revision_restore_failed
easymde/v1
```

扩展 descriptor 必须是版本化、可验证的数据，不执行任意 JavaScript，不传递 React Element/Component，不暴露内部 Store、Adapter 或私有 DOM。
收紧字段含义或移除边界前，先完成消费者清点、兼容测试、迁移和人工批准。

Article Theme、Code Theme 和共享 Mac code frame 是三个独立 CSS owner。
Article Theme 负责文章表现，Code Theme 负责 token palette，shared frame 负责固定代码框几何；它们不能复制彼此的 selector 或变成另一个 surface 的隐藏覆盖。
每个 Article Theme 可以关联自己的默认 Code Theme，但有效的显式用户选择始终优先，缺失或无效的 fallback 不在打开时写回。

字体选项按有效 font stack 和 fallback 语义去重，历史 ID 只作为兼容别名。
可再发行的运行时 JavaScript、CSS、Font、Icon 和 SDK 使用本地锁定来源，由安装包交付；真正的 External Service 另需聚焦批准、隐私/Consent、最小数据、认证、失败合同、更新 owner 和移除计划。
CDN 或远程静态脚本不是本地资源的替代方案。

## 六、可维护性原则

EasyMDE 的架构优先保护数据 authority、WordPress 兼容、扩展稳定性、错误可见性、无障碍和可复现交付。
React 代码应保持局部、可组合、可测试和可移除；抽象以真实责任和消费者为前提，而不是以文件数量或流行模式为理由。
性能优化先有代表性测量，不能牺牲 Selection、IME、Undo、Focus、Scroll、Native Form 或失败可追踪性。

无障碍不是额外装饰：键盘、IME、焦点进出、Dialog、Toolbar、Split Pane、RTL、缩放、文本伸缩、Reduced Motion、Forced Colors 和长翻译都属于相应界面 owner 的合同。
公共页面继续由 PHP 渲染，不加载后台 React 应用。

WeChat 是兼容性导出，不是持久化或发布路径。
本文只保留这一边界；序列化实现由 `.agents/skills/easymde/references/wechat-export.md` 负责，决策理由由 [ADR-001](decisions/ADR-001-wechat-clipboard-serialization.md) 负责，验证步骤由 [Testing and Release](TESTING_AND_RELEASE.md) 负责，用户可观察行为由 [User Guide](USER_GUIDE.md) 负责。

稳定边界改变时，先更新对应的当前 owner，再更新本文的长期理由和路由，移除过时规则而不是追加矛盾例外。
所有测试、浏览器、性能、无障碍、Review 和发布结论必须以实际执行证据为准。
