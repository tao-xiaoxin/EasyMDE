# EasyMDE React 设计哲学与架构原则

本文定义 EasyMDE WordPress 后台 React、TypeScript 与 Vite 应用的长期设计哲学和架构原则。

它回答“为什么这样设计、责任属于谁、边界如何长期保持稳定”，不是迁移阶段清单，也不是逐条编码检查表。日常实现规则由 `.agents/skills/easymde/SKILL.md` 负责；旧 JavaScript 向 React 转移期间的临时执行规则由 `.agents/skills/easymde-migration/SKILL.md` 负责。

任何目录、接口、依赖或抽象都只能在当前功能确有需要时创建。本文描述目标边界，不授权批量创建空目录、占位模块或未来框架。

## 阅读导航

- 先读“权威来源与证据策略”和“核心设计哲学”，理解项目优先级、状态所有权与 WordPress 边界。
- 查阅目录、依赖与接口决策时，读“React 运行时与应用 Root”至“Port、Runtime 与 Adapter”。
- 实现功能时，按需查阅状态、跨语言边界、正式数据流、组件 API、UI、性能与发布包章节。
- 判断本地或远程资源交付方向时，读“资源交付与发行渠道”；逐资产证据、批准与实施检查使用 `.agents/skills/easymde/SKILL.md`。
- 日常执行检查使用 `.agents/skills/easymde/SKILL.md`；转移现有浏览器功能时另外使用 `.agents/skills/easymde-migration/SKILL.md`。
- 本文与实时代码不一致时，先根据本文的证据优先级确定是实现欠账还是文档过时，不得默认任何一方自动覆盖另一方。

## 一、权威来源与证据策略

规则按以下优先级解释：

1. 当前任务中的明确指令和人工维护者决定。
2. 根目录 `AGENTS.md`、实时仓库和现有公开兼容合同。
3. 在前两项边界内解释的当前聚焦 GitHub Issue 和 Pull Request。
4. `docs/ARCHITECTURE.md` 与本文。
5. `.agents/skills/easymde/SKILL.md`；迁移任务再叠加 `.agents/skills/easymde-migration/SKILL.md`。
6. 与项目最低支持版本匹配的 React、WordPress、TypeScript 和 WAI-ARIA 官方文档及官方源码。
7. 已实际加载的通用 Skill。
8. react-admin 等成熟项目的设计经验。
9. 博客、公众号、搜索摘要和其他二手资料。

关联、总览、已关闭或历史 Issue 只能提供证据和范围上下文，不能单独覆盖已合并的项目合同。实质性合同变更必须有当前人工维护者的明确决定，并遵循该变更所需的仓库工作流。

低优先级资料只能补充，不能覆盖 EasyMDE 的数据、安全、WordPress、保存、发布、预览、扩展、隐私、测试和发布包合同。

### 官方资料基线

维护者和 Agent 应优先从以下固定入口核对原则，避免依赖搜索摘要或被复制、改写的内容：

```text
React
https://react.dev/learn/thinking-in-react
https://react.dev/learn/keeping-components-pure
https://react.dev/learn/choosing-the-state-structure
https://react.dev/learn/sharing-state-between-components
https://react.dev/learn/passing-data-deeply-with-context
https://react.dev/learn/you-might-not-need-an-effect
https://react.dev/learn/reusing-logic-with-custom-hooks
https://react.dev/reference/rules/rules-of-hooks
https://react.dev/learn/updating-objects-in-state
https://react.dev/learn/passing-props-to-a-component#forwarding-props-with-the-jsx-spread-syntax
https://react.dev/reference/react/useSyncExternalStore
https://react.dev/reference/react/Component#catching-rendering-errors-with-an-error-boundary
https://react.dev/reference/react/useId

WordPress
https://developer.wordpress.org/block-editor/reference-guides/packages/packages-element/
https://developer.wordpress.org/plugins/security/nonces/
https://developer.wordpress.org/rest-api/extending-the-rest-api/adding-custom-endpoints/
https://developer.wordpress.org/plugins/plugin-basics/best-practices/
https://developer.wordpress.org/reference/functions/wp_enqueue_script/
https://developer.wordpress.org/reference/functions/wp_enqueue_script_module/
https://github.com/WordPress/wordpress-develop/tree/6.7
https://github.com/WordPress/wordpress-develop/blob/6.7/package-lock.json
https://github.com/WordPress/wordpress-develop/blob/6.7/src/wp-includes/assets/script-modules-packages.min.php
https://github.com/WordPress/gutenberg/blob/wp/6.7/packages/element/src/react.js
https://github.com/WordPress/gutenberg/blob/wp/6.7/packages/element/src/react-platform.js

TypeScript
https://www.typescriptlang.org/tsconfig/strict.html
https://www.typescriptlang.org/docs/handbook/2/everyday-types.html

Vite
https://vite.dev/guide/features.html#typescript

Accessibility
https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/
https://www.w3.org/WAI/ARIA/apg/patterns/toolbar/
https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html

Design reference
https://github.com/marmelab/react-admin/blob/master/.agents/skills/react-admin/SKILL.md
https://marmelab.com/react-admin/Architecture.html
https://marmelab.com/react-admin/DataProviders.html
```

当前 React 官方站点可能默认展示 React 19。EasyMDE 的平台基线是 WordPress 6.7 与 PHP 7.4；PHP 集成继续遵循 WordPress Coding Standards。React 运行时结论必须同时满足 WordPress 6.7 的实际源码。WordPress 6.7 使用 React 与 ReactDOM 18.3.1，并通过 `@wordpress/element` 暴露运行时；提高最低 WordPress 版本前必须重新核对对应 Tag，不能把最新 Gutenberg 文档直接当成当前 Core 能力，也不能在 React 任务中无意引入高于 PHP 7.4 的语法。

无法由官方文档、匹配版本源码或实时仓库证明的结论，应记录为待确认项，不得写成架构事实。

## 二、核心设计哲学

### 1. WordPress 是宿主平台和最终权威

React 是 EasyMDE 后台交互界面的实现工具，不是新的 CMS、权限系统、渲染后端或发布平台。

PHP 和 WordPress 继续负责持久化、安全、正式 Markdown 渲染、修订、媒体、分类、原生保存和发布、文章状态、站点时区、设置以及公开内容。React 负责声明式界面、交互编排和浏览器编辑会话状态。

设计必须顺着 WordPress 生命周期工作，而不是把 WordPress 当成一个需要绕过的旧后端。

### 2. 先理解数据模型，再设计组件树

React 官方建议让组件结构匹配数据模型，并先构建由数据驱动的静态界面，再加入交互。

EasyMDE 的顺序是：

1. 明确用户目标和 WordPress 平台约束；
2. 明确持久化数据、编辑会话数据、派生数据和提交桥接数据；
3. 列出加载、空、就绪、权限不足、冲突、失败、取消和恢复状态；
4. 为每个事实指定唯一所有者；
5. 按用户可理解的职责划分组件；
6. 先实现纯渲染；
7. 再通过事件、Command、Port 和显式状态转换加入交互。

禁止先创建通用组件库、全局 Store、万能 Service 或完整未来目录，再寻找使用场景。

### 3. Render 保持纯粹

相同 Props、State 和 Context 必须产生相同 JSX。

Render 阶段不得：

- 修改 Props、State、Context、Registry 或 Adapter；
- 修改 WordPress DOM、浏览器全局、Storage 或 Clipboard；
- 保存、发布、上传或恢复修订；
- 注册订阅、Timer、Observer 或事件监听器；
- 发起依赖副作用的 Mutation；
- 输出文章正文、Nonce、Token 或私密配置。

用户动作在 Event Handler 或明确 Command 中执行。Effect 只用于与 React 外部系统同步，并且必须有单一职责、正确依赖、失败路径和幂等清理。

### 4. 每个事实只有一个权威所有者

典型所有权：

```text
持久化 Markdown             → PHP / _easymde_markdown
当前编辑会话 Markdown       → 最近的 Editor Session Owner；确需跨 Feature 协调时才进入 Root Store
持久化文章标题              → WordPress / post_title
当前编辑会话标题            → 最近的 Editor Session Owner；确需跨 Feature 协调时才进入 Root Store
兼容 HTML                   → PHP MarkdownRenderer / post_content
正式预览 HTML               → Preview REST 响应
原生表单序列化              → WordPress Submission Bridge
权限、Nonce、锁和认证状态   → WordPress，通过 SessionPort 暴露
未确认的 Dialog 草稿        → 最近的 Feature Owner
设置持久化                  → WordPress Options API
恢复用本地草稿              → 版本化 Recovery Store
公开文章输出                → PHP / WordPress
```

同一事实不得为了访问方便同时复制到 Component State、Context、Root Store、Query Cache、DOM Field、Storage 和 PHP。

### 5. State 是最小、完整且无矛盾的表示

- 能从 Props 或已有 State 计算的值不进入 State；
- 总是一起变化的值可以作为一个原子状态；
- 不能同时成立的状态用 Discriminated Union 表达；
- Dirty、统计、是否可发布等值应派生；
- 临时输入留在最近所有者；
- 只有多个消费者需要协调时才提升状态；
- State 通过实体身份和产品规则有意保留或重置；
- Props、React State、Store Snapshot 和 Port Result 都作为只读值处理，通过所属 Owner 的 Action / Setter 创建新值，不原地修改对象或数组；
- 不通过随机 Key、嵌套定义组件或无意改变树位置重置状态。

Custom Hook 共享的是有状态逻辑，不是同一个 State 实例。真正共享的 State 必须有明确 Owner。

### 6. 单向数据流和显式反向操作

数据从 Owner 向下流动，用户意图通过命名清晰的 Callback、Command 或 Port 返回 Owner。

避免双向绑定式的隐式同步，也避免用 Effect 监听一个布尔值后间接执行用户命令。发布、恢复修订、插入媒体等行为应在对应事件路径中清楚可追踪。

### 7. 组合优于 God Component 和配置爆炸

吸收 react-admin 的组合思想：复杂界面通过子组件、命名 Slot、窄 Context 和可替换 View 组合，而不是让一个组件接受几十个相互影响的 Props。

但组合不是为了制造框架。只有当子区域有独立语义、状态、无障碍合同、失败边界或真实复用需求时才拆分。

### 8. Headless 行为与 View 在需要时分离

当复杂 Feature 需要多个视觉版本、独立测试行为或可替换 UI 时，可使用：

```text
useXController()  → 状态、动作、派生元数据
XView             → 纯 UI 和用户事件
X                 → 组合 Controller 与 View
```

这借鉴 react-admin 的 Controller Hook 与 View 分离，但不要求每个 Feature 都创建 Controller 层。简单组件保持简单。

### 9. 边界显式，内部实现可替换

外部系统通过 Port 表达项目意图，通过 Adapter 连接 WordPress、REST、DOM、Media、Storage 和 Clipboard。

组件不直接调用 `fetch`、`wp.apiFetch`、jQuery、`wp.media`、WordPress Selector 或全局 Bootstrap。这样才能集中处理认证、Nonce、Capability、错误映射、取消、过期结果和清理。

### 10. 约定减少重复，但不能隐藏关键行为

目录、命名、Port 形状和 Feature 公共出口应有稳定约定，减少每个任务重新发明结构。

但保存、发布、权限、迁移、回滚和错误处理必须显式。不要用“魔法”自动发现目录、自动执行 Mutation、自动注册未知扩展或静默回退来减少代码量。

### 11. 失败必须可见、可诊断、可恢复

每个外部操作都需要：

- 明确 Owner；
- 类型化输入和输出；
- 权限与运行时验证；
- 取消、冲突或过期语义；
- 来自真实平台 Owner 的成功信号；
- 用户可理解的失败状态；
- 不泄露正文和秘密的稳定诊断代码；
- 最低可靠层级的测试。

没有证据时不要显示成功，也不要用近似结果掩盖正式路径失败。

### 12. 外部 State 必须通过一致订阅进入 React

WordPress、旧编辑器实例和浏览器 API 中会变化的 State 不能靠 Render 时读取、轮询或 Effect 镜像保持同步。通过 `useSyncExternalStore` 和项目 Hook 暴露稳定订阅与不可变 Snapshot，保证一次 Render 看到一致版本并在 Teardown 时解除订阅。

### 13. 异步操作必须声明并发和权威结果

每个异步能力都明确采用 latest-wins、single-flight、parallel-keyed 或 ordered 策略，并绑定 Owner Identity、Operation ID、Abort、Stale Result 和真实平台结果。WordPress 写操作默认等待权威结果；不能因为浏览器请求被 Abort 就假定服务端没有提交。

### 14. Error Boundary 不是通用错误处理器

Error Boundary 隔离后代 Render 和生命周期故障，但不替代 Event Handler、Promise、Timer、Port 或 Mutation 的错误处理。预期失败进入 Typed Result 和显式 UI State；Fallback 不宣称持久化成功，也不应丢失可保留的未保存文档。

### 15. 国际化是一条端到端构建合同

一个字符串只有一个翻译 Owner。React 文本、提取、Catalog、Script Dependency、WordPress 注册、Release ZIP、Plural、Context、RTL 和测试必须作为同一条交付链设计，不能只在 JSX 外包一层 `__()` 就宣称完成。

### 16. 安装版 ZIP 是产品，不是构建副产物

源码架构和运行时交付必须同时设计。开发环境可用的代码只有在依赖、Manifest、翻译、本地资源和安装版 ZIP 中都正确时才算完成。

## 三、从 react-admin 吸收什么

React-admin 值得学习的是设计思想，而不是它的技术栈。

### 采用的思想

- **Provider/Adapter 边界**：UI 不认识后端传输细节；EasyMDE 使用 Port + Adapter 表达同一原则。
- **Composition over configuration**：通过可组合子组件和 Slot 替换局部行为，避免 God Component。
- **Headless Controller**：复杂行为可由 Hook 暴露，View 可以替换。
- **Context pull model**：语义子树可通过窄 Hook 获取附近 Owner 的数据和动作。
- **先复用稳定能力，再写自定义代码**：先检查现有 Port、Feature、UI Primitive、Registry、WordPress API 和兼容入口。
- **标准化内部契约**：不同 Adapter 返回一致的项目结果，Feature 不解析每一种 WordPress 或 REST 形状。

### 不照搬的部分

EasyMDE 不自动引入：

- react-admin 的 `Resource` CRUD 模型；
- React Query、React Hook Form、React Router 或 Material UI；
- `dataProvider`、`authProvider`、`i18nProvider` 的原始接口；
- SPA 路由；
- 默认 Optimistic 或 Undoable Mutation；
- 通用后台权限模型；
- react-admin 的 Store、缓存或离线方案。

WordPress 已经拥有页面路由、权限、Nonce、保存、发布、修订、媒体和翻译体系。任何类似能力都必须先证明现有 WordPress 契约无法满足当前需求。

## 四、架构术语

为避免同一词表示多个概念，统一使用：

- **Feature**：用户可识别的完整能力，例如 Publishing、Revisions、Custom CSS。
- **Domain**：不依赖 React、DOM、WordPress、网络或 Storage 的纯业务规则。
- **Port**：Feature 面向外部能力的稳定 TypeScript 接口。
- **Adapter**：Port 对 WordPress、REST、DOM 或浏览器 API 的具体实现。
- **Runtime**：一个应用 Root 所需 Ports 的组合对象。
- **App Provider**：在子树确有注入需求时，把 Runtime、Store、翻译或其他稳定依赖放入 React 树的组件；不是每个 Root 的必备层，也不是后端 Adapter。
- **Controller Hook**：复杂 Feature 的 Headless 行为层。
- **View**：由类型化状态和动作驱动的 UI。
- **Store**：多个 Feature 确需协调时，由一个应用 Root 按 Mount 拥有的浏览器会话状态 Owner；不是每个 Root 的必备层。
- **Bootstrap Contract**：PHP 向某一 Root 提供的版本化、运行时可验证数据。
- **Submission Bridge**：把已接受的编辑会话状态同步到 WordPress 原生提交字段的桥梁。
- **Safe Preview HTML**：通过正式 PHP 渲染和清洗后，才允许进入预览 Sink 的品牌化值。
- **External Store Contract**：React 读取外部可变 State 时使用的稳定 `subscribe`、不可变缓存 `getSnapshot` 和 Cleanup 合同。
- **Operation Policy**：异步能力的 latest-wins、single-flight、parallel-keyed 或 ordered 并发规则及权威结果处理。
- **Translation Owner**：某一用户可见字符串的唯一提取、翻译、加载和运行时来源。

在 EasyMDE 中，“Provider”默认指 React App Provider。外部能力使用 Port 和 Adapter 命名，避免与 React Context 混淆。

## 五、产品与平台所有权

### React 负责

- EasyMDE 后台 UI 渲染；
- 用户交互和组件组合；
- Dialog、Panel、Toolbar 和布局；
- 浏览器编辑会话中的临时状态；
- 对 Port 的调用编排；
- 加载、空、错误、权限不足、冲突和恢复状态的呈现。

### PHP 和 WordPress 负责

- 插件加载、Hook 和服务装配；
- 支持的 Post Type 准入；
- Capability、Nonce、认证和锁；
- Post Meta、Options API、Autosave 和 Revisions；
- Markdown 正式渲染和 HTML 安全过滤；
- Custom CSS 安全策略；
- Media Library 和上传权限；
- Taxonomy、Featured Image、Status 和 Scheduling；
- 原生 Save 和 Publish；
- Frontend、Feed、Search、Email 和 REST Consumer 的兼容 HTML；
- Article Theme、Code Theme 和公共扩展 Registry。

不可改变的合同：

- `_easymde_markdown` 是唯一权威 Markdown；
- `_easymde_enabled` 只描述已存储文档状态，不决定 Supported Post 是否进入 EasyMDE；
- 不存在 `_easymde_markdown` Meta 与存在但值为空字符串是两个不同状态；PHP 使用 `metadata_exists()` 判定，Bootstrap 与 TypeScript Runtime Schema 必须保留这个差异，不能依赖字符串 Truthiness；
- `post_title` 是唯一权威持久化标题；React 标题只是编辑会话 State，WordPress 原生标题字段只是 Submission Bridge；
- `post_content` 是安全渲染的 WordPress 兼容输出；
- WordPress 编辑表单是开放的兼容界面，不是由 React 定义的封闭 Schema；除非聚焦合同明确委托某个字段，否则原生与扩展注册的字段、控件、Meta Box、Submit Hook 和未知表单数据仍由 WordPress 或其注册者拥有；
- `EasyMDE\Content\MarkdownRenderer` 是唯一正式生产 Renderer；
- 普通支持文章打开时零写入，直到下一次合法保存；
- 普通支持文章没有已存储 Markdown 时，由现有 PHP `Migration` Owner 在内存中从 Compatibility HTML 导入；React 不建立 Browser HTML-to-Markdown Authority，也不在合法保存前持久化导入结果；
- `_easymde_render_signature` 只是 PHP 拥有的一致性标记，不能替代 Markdown Authority；
- `_easymde_code_mac_style` 与 `codeMacStyle` 是不再生效的历史数据；保留已有存储值，但不读取、写入、迁移、归一化、复制到 Revision、恢复或暴露为 Browser State；
- 当前受保护的 EasyMDE Meta 继续作为一个一致文档状态参与 Revision Copy 与 Restore；
- React 不创建第二权限、渲染、保存、发布、修订、媒体、设置、时区或公开内容权威；
- 公开访问页面继续由 PHP 渲染，不加载后台 React 应用。

## 六、React 运行时与应用 Root

EasyMDE 最低支持 WordPress 6.7，并使用 WordPress 提供的 React 18 Runtime：

```text
@wordpress/element
wp-element
```

后台应用按真实 Screen 或独立加载 Surface 使用彼此独立的 Root，而不是一个接管整个 WordPress 后台的 SPA：

```text
admin-editor
settings（仅当聚焦任务实际创建 React Settings 应用时）
```

每个 Root 独立拥有：

- Entrypoint；
- Bootstrap Contract；
- Runtime；
- Error Boundary；
- 实际创建的 Subscription；
- Mount / Unmount 生命周期。

Root Store 和 App Provider 不是必备层。只有多个 Feature 确实需要共享会话 State，或子树确实需要注入 Runtime 等稳定上下文时，才由该 Root 按 Mount 创建并拥有 Store 或 Provider。简单 Root 使用类型化 Props，State 留在最近的 Component 或 Feature Owner。

若聚焦任务创建 React Settings Root，Editor 和 Settings 可共享纯 Domain、Contracts 和真正通用的 UI Primitive，但不能共享可变 Store、Context Instance、Query Cache 或生命周期 Owner。

每个 Entrypoint、CSS、Bootstrap Contract 和 WordPress Dependency 只在所属后台 Screen 的 PHP 准入规则通过后加载。Editor 还必须服从 Supported Post Type 与 Capability 边界；不得在无关后台页面或公开页面加载后台 React 应用，也不得把“浏览器端找不到 Root”当作主要资源准入机制。

运行时规则：

- 使用 WordPress 提供的 `@wordpress/element`；
- 使用 `createRoot`；
- Root 必须保存并执行 `root.unmount()`；
- PHP 为每个 Root 输出专属且初始为空的 Mount Container，并把该 Container 的 Child Ownership 独占委托给 React；
- 必须保留的 WordPress、Extension 与 Legacy DOM 留在 Mount Container 外；首次 `root.render()` 会替换 Container 中的既有 HTML，不能把它当作保留旧 DOM 的机制；
- Active React Container 不得再由 Legacy Code 删除、替换或写入；Ownership 只在声明的 Handoff 点切换，并在 `root.unmount()` 与 Cleanup 完成后释放；
- 不对后台 Root 使用 Hydration；
- 不打包第二份 React 或 ReactDOM；
- 不跨 React Runtime 传递 Element、Context、Hook、Portal 或 Ref；
- 不使用 React 19 专属 API；
- 编译、测试与类型声明所使用的 React、ReactDOM、`@types/react`、`@types/react-dom`、`@wordpress/element` 和 JSX Runtime 必须与 WordPress 6.7 已验证的 React 18 能力面一致，不能用 React 19 或更新 Gutenberg 类型检查通过来替代最低运行时验证；
- 不为 WordPress 6.7 以下版本维护兼容分支；
- `StrictMode` 的重复 Render 和 Effect Replay 用来暴露不纯逻辑与错误清理，不能通过关闭检查掩盖问题。

默认不引入 Router。WordPress 负责页面导航；Tab、Panel 和 Dialog 不构成路由需求。

外部 State 和 Error Boundary 合同：

- WordPress Lock、Session、浏览器 API 或 legacy Store 等外部可变值通过 `@wordpress/element` 提供的 `useSyncExternalStore` 接入；
- `subscribe` 稳定且可清理，`getSnapshot` 在未变化时保持同一身份，不通过 Effect 复制成第二份 State；
- 管理后台 Root 不使用 SSR / Hydration，因此不为外部 Store 发明 `getServerSnapshot`；
- Root Error Boundary 隔离 Render / Lifecycle 故障，Feature Boundary 只围住可独立恢复区域；
- React 18 尚无 `getDerivedStateFromError` / `componentDidCatch` 的函数组件等价 API；项目最小 Error Boundary 可以是类组件，不得为回避这个例外而发明 Error Boundary Hook 或无依据引入包装依赖；
- Event、Promise、Timer、Port 和 Mutation 失败仍由对应 Owner 的 Typed Result、State 和 Diagnostics 处理；
- Fallback 保留可安全保留的未保存 State，并以 Root、Post 或 Feature Owner Identity 明确 Reset。

## 七、目录结构

保留一个根 `package.json` 和一个 Lockfile：

```text
EasyMDE/
├── package.json
├── package-lock.json
├── frontend/                    React / TypeScript source
├── assets/build/                compiled runtime assets
├── src/                         PHP production code
├── templates/                   PHP templates
├── scripts/                     build, release and validation
├── tests/
└── docs/
```

禁止创建 `frontend/package.json` 或第二个 Lockfile。

目标源码结构：

```text
frontend/
├── vite.config.ts
├── vitest.config.ts             # only when Vitest is introduced
├── tsconfig.json
├── eslint.config.js             # only when ESLint is introduced
└── src/
    ├── entrypoints/
    │   ├── admin-editor.tsx
    │   └── settings.tsx                 # only when a React Settings Root exists
    ├── app/
    │   ├── editor/
    │   │   ├── EditorApp.tsx
    │   │   ├── EditorProviders.tsx      # only when subtree injection is required
    │   │   ├── EditorErrorBoundary.tsx
    │   │   ├── create-editor-store.ts   # only when cross-Feature session state exists
    │   │   ├── store/                   # same condition as the Root Store
    │   │   └── styles/
    │   └── settings/                    # only when a React Settings Root exists
    │       ├── SettingsApp.tsx
    │       ├── SettingsProviders.tsx    # only when subtree injection is required
    │       ├── SettingsErrorBoundary.tsx
    │       ├── create-settings-store.ts # only when cross-Feature session state exists
    │       ├── store/                   # same condition as the Root Store
    │       └── styles/
    ├── contracts/
    │   ├── bootstrap/
    │   ├── ports/
    │   ├── schemas/
    │   ├── errors/
    │   ├── editor-runtime.ts
    │   └── settings-runtime.ts          # only when a React Settings Root exists
    ├── domain/
    │   ├── document/
    │   ├── markdown/
    │   ├── appearance/
    │   ├── publishing/
    │   ├── revisions/
    │   └── settings/
    ├── features/
    ├── integrations/
    │   ├── wordpress/
    │   │   ├── bootstrap/
    │   │   ├── document/
    │   │   ├── session/
    │   │   ├── save/
    │   │   ├── preview/
    │   │   ├── appearance/
    │   │   ├── custom-css/     # 仅在对应 Port 与真实 Adapter 存在时创建
    │   │   ├── publishing/
    │   │   ├── revisions/
    │   │   ├── media/
    │   │   ├── settings/
    │   │   ├── ai/             # 仅在批准的 AiPort 与服务端边界真实存在时创建
    │   │   └── rest/
    │   ├── preview-runtime/
    │   └── browser/
    │       ├── storage/
    │       ├── clipboard/
    │       └── diagnostics/
    ├── shared/
    │   ├── ui/
    │   ├── hooks/
    │   ├── icons/
    │   ├── i18n/               # 仅限有稳定消费者的平台无关辅助代码
    │   └── types/
    └── test/
        ├── setup.ts
        ├── fixtures/
        ├── factories/
        └── mock-runtime/
```

目录只在当前任务需要时创建。不得一次性创建完整树，也不得创建通用根目录 `components/`、`services/`、`helpers/`、`utils/` 或 `lib/` 作为杂物箱。

### 层职责

- `entrypoints/`：定位 Root、解析 Bootstrap、组装 Runtime 和按需 Store、Mount、Ready、Teardown。
- `app/`：Root Shell、Error Boundary、顶层组合，以及确有共享状态或注入需求时的 Provider 和 Store。
- `contracts/`：运行时 Schema、Ports、Result、Error Code、Safe Value 和 Manifest Contract。
- `domain/`：纯业务规则，不依赖 React、DOM、WordPress、网络或 Storage。
- `features/`：用户可识别能力。
- `integrations/`：WordPress、REST、DOM、Media、Preview Enhancement 和浏览器 Adapter。
- `shared/`：至少两个稳定消费者真正共享、且没有 Feature 或 WordPress 所有权的代码；其中 `shared/i18n/` 只容纳已证明平台无关的辅助代码，Feature 文案以及 WordPress Catalog、Locale 与加载所有权不得转移到这里。
- `test/`：跨模块测试支持；普通测试与源码同目录。

### 依赖方向

```text
entrypoints  → app, contracts, integrations
app          → features, contracts, shared
features     → other Feature public APIs, domain, contracts, shared
domain       → shared pure types/utilities only
contracts    → domain types, shared types only
integrations → contracts, domain, shared
shared       → no app, feature, integration or WordPress ownership
```

该表约束架构层之间的依赖。在 `integrations/` 内部，一个能力 Adapter 可以依赖同一平台中明确更低层的传输模块，例如 `integrations/wordpress/preview/` 使用 `integrations/wordpress/rest/`。这种内部次序必须显式、无环，且底层传输不得反向导入 Feature 语义或能力 Adapter。它不授权跨平台捷径、同级语义循环或万能 Service。

Feature 不导入具体 Adapter；Entrypoint 负责组装。Feature 之间只能通过窄 `index.ts` 公共 API 建立无环依赖；禁止循环依赖、向上导入、跨 Feature 私有深层导入和通过 Barrel 隐藏依赖。

## 八、Feature 内部结构

按用户能力命名 Feature，例如：

```text
markdown-editor
live-preview
outline
appearance
custom-css
publishing
revisions
media
local-drafts
wechat-export
ai-assistant
```

复杂 Feature 可使用：

```text
features/publishing/
├── ui/
│   ├── PublishingDialog.tsx
│   └── PublishingActions.tsx
├── controller/
│   └── usePublishingController.ts
├── model/
│   ├── publishing-reducer.ts
│   ├── publishing-selectors.ts
│   └── publishing-state.ts
├── styles/
│   └── publishing.css
├── publishing.types.ts
└── index.ts
```

不是每个 Feature 都要创建所有子目录。

- `ui/`：展示与直接交互；
- `controller/`：复杂 Feature 的 React 编排；
- `model/`：Feature 局部状态转换和 Selector；
- `styles/`：Feature 范围样式；
- `index.ts`：窄、命名明确的公共 API。

跨 Feature 可复用的纯业务规则进入 `domain/`；只有稳定的跨 Feature UI Primitive 才进入 `shared/ui/`。

## 九、接口设计哲学

### Port、Adapter 和 Runtime

Feature 依赖项目意图，不依赖传输细节。不得先定义包含全部未来能力的万能 Runtime；每个真实消费者先声明窄 Capability Slice：

```ts
export type PreviewRuntime = Readonly<{
  preview: PreviewPort;
  diagnostics: DiagnosticsPort;
}>;

export type AppearanceRuntime = Readonly<{
  appearance: AppearancePort;
  diagnostics: DiagnosticsPort;
}>;
```

应用边界上的 `EditorRuntime` 只组合当前已由该 Editor Root 拥有和提供的 Capability Slice。只有真实 Feature 与 Adapter 实现时才扩展；不得为目录对称或理想终态声明 Optional Placeholder Port。Feature 接收自己的窄 Slice，不接收完整 Root Runtime。

若聚焦任务创建 React Settings Root，它不复用 Editor Runtime，而只接收自己实际需要的能力：

```ts
export interface SettingsRuntime {
  settings: SettingsPort;
  diagnostics: DiagnosticsPort;
}
```

`AppearancePort` 的具体实现归入 `integrations/wordpress/appearance/`，不得退化为宽泛 `rest/` 杂物。`CustomCssPort`、`AiPort` 等 Feature 专属能力只在对应 Feature 与真实 Adapter 被批准并实现时加入所属 Runtime。

Port 与 Integration 的对应关系必须可从目录直接判断：Document、Save、Session、Preview、Appearance、Custom CSS、Publishing、Revision、Media 和 Settings 的 Adapter 在对应能力真实存在时分别进入 `integrations/wordpress/<capability>/`；Storage、Clipboard 与浏览器 Diagnostics 进入 `integrations/browser/`。批准 AI Feature 后，浏览器 `AiPort` Adapter 进入 `integrations/wordpress/ai/`，并且只连接 EasyMDE 已授权的服务端边界；Provider Credential 与 Provider-specific Authority 留在聚焦的 PHP / Server Owner 中，绝不进入 `frontend/`。`integrations/preview-runtime/` 只负责正式 Preview 响应之后的 Mermaid、KaTeX、Highlight.js 与 TOC Enhancement，不拥有 `PreviewPort` 的服务端请求合同。`integrations/wordpress/rest/` 可承载共享传输机制，但不拥有 Feature 语义，也不能变成万能 Service。

原则：

- 一个 Port 表示一个外部责任；
- 方法按业务意图命名，不按 DOM 或 HTTP 细节命名；
- Query 与 Command 在语义上分离；
- 返回不可变 Snapshot；
- 预期的取消、权限不足、锁冲突、验证失败和不可用状态使用 Discriminated Union；
- Exception 保留给程序缺陷或无法正常表示的基础设施故障；
- 可取消异步操作接收 `AbortSignal`；
- Subscription 返回幂等 `unsubscribe()`；
- Server Error Code、HTTP Status 和翻译后的用户消息分别保存；
- 多个相关参数或未来可能扩展的参数使用 Options Object；
- 避免 Boolean Parameter；
- 不暴露 DOM Node、REST Client、Concrete Store 或 WordPress Global；
- 不创建 `execute(type, payload)`、万能 `WordPressService` 或字符串事件总线。

### 异步操作合同

按语义选择并记录：

```text
latest-wins      Preview、Search、Filter、Detail Read
single-flight    Save、Publish、Settings Write、Revision Restore
parallel-keyed   独立 Upload / Read，每个操作有稳定 Key 和 Owner
ordered          Document Transaction 或顺序会改变含义的操作
```

- Presentation Disabled State 不能替代 Controller / Store / Adapter 中的并发控制；
- Operation 绑定 Site、User、Post、Root、Feature 或 Transaction Identity；
- Owner 变化、Dialog 关闭或新 Request 接管后，旧结果不得更新当前 UI；
- Abort Browser Observation 不等于 WordPress Mutation 未提交，必须与权威结果 Reconcile；
- WordPress Write 默认 Pessimistic；Optimistic / Undoable 只用于经批准、可逆、可回滚并可无障碍表达的合同。

### Controller 与 View

复杂 Feature 的 Controller 返回稳定、可理解的结构：

```ts
type PublishingController = Readonly<{
  state: PublishingState;
  actions: PublishingActions;
  meta: PublishingMeta;
}>;
```

- `state`：View 所需状态；
- `actions`：用户意图；
- `meta`：Capability、Pending、Conflict 等派生元数据。

不要把具体 Adapter、原始 REST 响应或 Store Setter 暴露给 View。

### Context 的使用

借鉴 react-admin 的“Pull, Don’t Push”，但保持边界：

- Context 只服务一个语义子树；
- 通过命名 Hook 暴露窄能力；
- 不把整篇 Markdown、高频 Selection 或整个 Root Store 放入宽 Context；
- 不为了避免两层 Props 就创建 Context；
- 不通过 Context 隐藏 Mutation Owner；
- Provider Value 的身份必须稳定，消费者使用窄 Selector。

## 十、State、Event、Effect 和生命周期

### State 分类

State 默认留在最近的 Owner。只有多个 Feature 必须协调同一浏览器会话事实时才提升到该应用 Root 的 Store；Root Store 按 Mount 创建且最多一个，不得导出模块级可变 Singleton。没有跨 Feature 共享状态的 Root 不为目录对称而创建 Store。

```text
Persisted authority     PHP / WordPress
Server-derived state    one explicit owner
Editor session state    nearest owner; root store only when shared across Features
Local UI draft          nearest Feature
Derived state           selector or render
Submission bridge       native WordPress fields
Recovery data           versioned local draft storage
Preferences             approved scoped browser storage or Options API
```

### Event 与 Effect

Effect 不用于：

- 计算可渲染派生数据；
- 把 Props 复制到 State；
- 镜像两个 Store；
- 因布尔值变为 `true` 而间接执行用户命令；
- 处理本可在点击事件中处理的 Save、Publish、Upload 或 Copy；
- 通过 Effect 重置本可由 Key 或显式事件表达的 Owner。

每个 Effect 必须有外部同步目标、完整依赖、失败路径和幂等 Cleanup。

清理对象包括 Listener、Subscription、Observer、Timer、Animation Frame、AbortController、Object URL、Portal、Overlay、临时 DOM、Body Class、Inline Style、CSS Variable、Scroll Lock、Selection 和 Pointer Capture。

### External Store

React-owned State 保持在最近的 React Owner，确需跨 Feature 协调时才进入 Root Store。读取外部可变 State 时使用项目 Hook 包装 `useSyncExternalStore`：`subscribe` 必须稳定并返回幂等 Cleanup；`getSnapshot` 返回 Immutable Snapshot，并在底层值未变化时复用同一对象；消费者只订阅最小 Slice。禁止轮询、每次返回新 Snapshot、Render 中直接读取后期待自动更新，或用 Effect 镜像到另一份 State。

## 十一、TypeScript 与命名哲学

从第一天启用严格 TypeScript。至少启用：

```json
{
  "compilerOptions": {
    "strict": true,
    "isolatedModules": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "useUnknownInCatchVariables": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true
  }
}
```

Vite 只 Transpile TypeScript，不执行 Type Check。开发和 CI 必须单独运行 `tsc --noEmit`。`isolatedModules` 保证代码适合逐文件转换，纯类型引用使用 `import type` / `export type`。`exactOptionalPropertyTypes` 与 `verbatimModuleSyntax` 在选定 React、WordPress 和 TypeScript 版本后验证启用。

命名约定：

```text
Directories             kebab-case
React components        PascalCase.tsx
Error boundaries        PascalCase.tsx
Hooks                    useFeatureName.ts
Controller hooks         useFeatureNameController.ts
Other TS modules         kebab-case.ts
Port files               capability-port.ts
Adapter files            platform-capability-adapter.ts
Schema files             contract-schema.ts
Type modules             feature.types.ts
CSS files                kebab-case.css
Tests                    source-name.test.ts / SourceName.test.tsx
```

原则：

- Hook 只在函数组件或 Custom Hook 顶层调用，不在条件、循环、Event Handler、类方法或普通函数中调用；Custom Hook 名称以 `use` 开头；
- 普通组件使用函数组件加显式 Props，不默认使用 `React.FC`；最小 React 18 Error Boundary 是有官方依据的类组件例外；
- 只有真正支持 Children 时才声明 `children: React.ReactNode`；
- React Event 使用具体类型或上下文推断，不使用 `any`；
- DOM Ref 以 `null` 初始化；
- React 18 下只有在 Shared UI Primitive 确实需要向 Owner 暴露原生 DOM Ref 时，才通过 `@wordpress/element` 的 `forwardRef` 实现；不得套用 React 19 的 Ref-as-Prop 或 no-`forwardRef` 规则；
- Native Control Wrapper 只有在组件 API 确实需要时才继承相应原生属性；组件拥有的不变量 Props 必须 Omit 或重新声明，`className`、Event 与 ARIA 合并顺序必须显式，不能让末尾 Props Spread 覆盖必需语义；
- 封闭 Props、Union、Tuple 和局部 Model 使用 `type`；
- 有意可扩展的 Port 和公共对象合同使用 `interface`；
- 外部值从 `unknown` 开始并在边界 Parse；
- Exported API、Port、Schema Parser 和 Async Boundary 写显式返回类型；
- Closed Union 必须穷尽处理；
- 避免 Non-null Assertion、Broad `export *` Barrel、随机 Key 和投机性 Generic；
- Utility Type 用于局部变换，不用长链 `Pick/Omit` 隐藏长期 Domain 语义；
- Comment 解释 Owner、安全、兼容、不变量或失败行为，不复述 JSX。

## 十二、跨语言与 WordPress 边界

TypeScript Interface 不能验证 PHP、REST、Storage、Manifest 或扩展输入。所有外部值在边界进行运行时验证。

版本化合同包括：

- Editor 和 Settings Bootstrap；
- REST Request / Response；
- Extension Command；
- Browser Storage；
- Vite Manifest 和 WordPress Dependency Metadata。

规则：

- Bootstrap 必须通过能安全序列化结构化数据的 WordPress Script API 输出；所选 API 需要序列化 JSON 时使用 `wp_json_encode()`。禁止拼接可执行 JavaScript 或 Raw JSON；合同位于 HTML Attribute、Text、Inline Script 或其他 Sink 时，PHP 必须使用该上下文对应的输出策略；
- PHP 端 Validation / Serialization / Escaping 与 TypeScript 端 Runtime Parsing 是同一边界不可省略的两半；
- Required Field 在 Mount 或执行操作前验证；
- Unknown Optional Field 可忽略，未知不兼容 Version 明确失败；
- 旧 Consumer 无法安全理解新 Payload 时提升 Version；
- 不原地改变字段语义；
- PHP/TS 使用代表性 Fixture 验证合同一致；
- 不序列化 Credential、Cookie、Private Config 或界面不需要的文章内容。

### 国际化合同

当前仓库由 PHP Gettext 提供浏览器字符串，并通过 Bootstrap 传入 JavaScript；现有 `scripts/i18n.mjs` 只提取 PHP。保持这一事实，直到独立 i18n / Build 任务完整引入 TS / TSX 路径。

每个用户可见消息实例只有一个翻译 Owner，不得同时由 PHP Bootstrap 和
JavaScript Catalog 提供。Error Code、ID、Route、Handle、Storage Key 和扩展
标识符不翻译；旧 JavaScript 的英文 Fallback 不是新的翻译权威，也不能掩盖
缺失的必需合同。

完整的 PHP / React 字符串所有权、提取、Catalog、Script Translation 加载、
Locale、Placeholder、Context、Plural、RTL 和安装包验证流程由
`.agents/skills/i18n/SKILL.md` 唯一负责；涉及 Legacy Owner 转移时同时使用
`.agents/skills/easymde-migration/SKILL.md`。本文只保留长期边界和当前事实，
不复制执行清单。

安全合同：

- Capability 决定授权；
- Nonce 只负责请求完整性和 CSRF 防护；
- 每个受保护 REST Route 有动作特定 `permission_callback`；
- 服务端验证每次写操作；
- 能精确判断时优先 Validation，之后再 Sanitization；
- 输出尽量靠近输出位置 Escape；
- REST 返回 Data、`WP_REST_Response` 或 `WP_Error`；
- Client 不根据翻译文本判断错误类型；
- Mutation 不自动 Retry；
- 只有有界、幂等 Read 可在支持 Abort 和过期结果保护时 Retry。

## 十三、正式数据流

### 预览

```text
Markdown
→ PreviewPort
→ POST easymde/v1/preview
→ PreviewController
→ MarkdownRenderer 生成并清洗 HTML
→ MarkdownFeatureDetector 生成 Feature Manifest
→ { html, features }
→ Safe Preview HTML Sink
→ 本地 Mermaid / KaTeX / Highlight.js / TOC Enhancement
```

Preview 必须支持 Abort、Request Identity、Stale Result 拒绝、Payload Limit、明确失败状态和 Enhancement Cleanup。

不得增加第二正式浏览器 Markdown Renderer，也不得用近似 Fallback 掩盖正式 Preview 失败。

### 保存与发布

```text
accepted editor transaction
→ synchronize Submission Bridge
→ native WordPress serialization
→ WordPress save / publish
→ observe real result
→ update saved baseline and UI
```

- Submission Bridge 不 Debounce；
- React 只修改聚焦合同明确委托的原生字段，并让 WordPress 序列化完整表单；不得用封闭的 TypeScript Allowlist 重建提交并丢弃未知的原生、Meta Box 或扩展字段；
- 同步字段不等于已持久化；
- 不 Force-click Disabled 或 Missing Control；
- 在权威 Mutation 开始前取消 Publish Draft 保持零写入；已开始的 WordPress Mutation 必须按其声明的取消与权威结果对账合同处理，不能因 Browser Abort 就宣称未提交；
- 保留 Heartbeat、Lock、Autosave、Nonce Refresh 和 Dirty State；
- Capability、Authentication 或 Lock 丢失后停止受保护写入。

### 修订、媒体和设置

- Revision Identity、Revision Kind 和 Persistence 属于 WordPress；不得静默丢弃当前未保存标题或 Markdown，须先执行明确确认 / Recovery 合同，再与服务端权威结果对账。EasyMDE Revision 在 PHP 渲染成功时恢复 Markdown、Appearance 与新生成的 Compatibility HTML；Renderer 不可用或渲染失败时可使用 Revision 存储的 HTML，但不会生成新 Render Signature。Revision 已存储的 Signature 会随其他 Meta 一同恢复，并继续按恢复后的 Markdown、Article Theme 和 Compatibility HTML 执行正常校验。恢复 Pre-EasyMDE Revision 会删除当前 EasyMDE Document-state Meta 并恢复历史 HTML，Browser 不得虚构 Markdown，也不得假定恢复后仍是 EasyMDE Document-state Post；
- Media Library 和 Upload 通过 `MediaPort`，成功后才插入 Markdown，并恢复 Selection、Focus 和 Undo Contract；
- 若聚焦任务创建 React Settings 应用，它使用独立 Root；`manage_options`、Options API、`register_setting()` 和 PHP Sanitization 始终是权威；
- Local Draft 是 Recovery Data，不是 WordPress Save，Key 必须包含 Site、User、Post Identity 和 Schema Version；合同还必须定义 Payload Limit、Retention / Expiry、权威保存后的 Cleanup、Re-key、显式 Discard 与跨 Tab Conflict，不能静默丢失较新的未保存内容；
- AI 只通过显式用户动作和 `AiPort` 工作；界面明确 Provider 与数据边界，只发送当前动作所需的最小上下文，并明确 Retention / Logging Policy。Model Output 始终是不可信输入，生成结果必须可预览、拒绝、撤销、取消并防止 Stale Result，不自动保存、发布、上传或执行返回代码。

### Custom CSS

- 完整编辑、预览、创建、更新和删除继续要求服务端 `unfiltered_html` Capability；Client Capability 只控制界面呈现；
- Custom CSS Library 继续存储在当前用户的 WordPress User Meta 中，REST 操作不得读取或修改其他用户的 Library；
- PHP `CustomCssPolicy` 与维护中的 CSS Parser 继续负责 Payload Limit、Blocked Feature、Normalization、Selector Scoping 和 Safe Output；
- React 只通过类型化 Port 展示输入和服务端结果，不实现 Browser CSS Security Parser，不把原始 CSS 当作 Safe Preview HTML，也不绕过服务端 Policy；
- 无法安全解析的 Legacy CSS 可按兼容合同保留原值，但不得输出到 Preview 或 Public Rendering。

## 十四、扩展与公共合同

迁移或修改前必须清点：

- `EasyMDE_Plugin::register_toolbar_button()` 与 `EasyMDE_Plugin::register_shortcode_helper()` 公共 Facade 入口；
- `easymde_supported_post_types` Editor Admission Filter；
- `easymde_category_options_cache_context` Category Cache Extension Filter；
- `easymde_category_options_load_failed` 与 `easymde_revision_restore_failed` Diagnostic Action；
- 其他现有 WordPress Actions 和 Filters；
- 固定 `easymde/v1` REST Namespace；
- Toolbar Registry；
- Shortcode Helper；
- `easymde_article_themes`、`easymde_code_themes`、Theme、Code Theme 与 Custom CSS ID；
- Script Handle；
- 公开 DOM Selector 和 Event；
- Extension Ordering、Collision 和 Failure 行为。

公共合同小而版本化，具体实现私有。扩展优先使用声明式、版本化 Descriptor 和稳定 Command ID，并验证 ID、Ordering、Collision、Capability Visibility 和 Failure。移除前先 Deprecate，并提供明确迁移和删除计划。

收紧 Browser Descriptor Schema 或改变 Dispatch 前，先用兼容测试刻画实时 PHP-to-Browser 合同：接受值与默认值、ID Sanitization 与 Collision、Output Ordering、Unknown Action 和 Failure Behavior。保留扩展可以依赖的行为；没有聚焦兼容决定时，不把偶然实现细节提升成新的永久承诺。

扩展 Payload 不执行任意 JavaScript，不传 Raw React Element / Component Constructor，不暴露内部 Store、Adapter、DOM Node 或 Feature Private Import。公开 React Render Slot 只有在独立 Issue 明确批准、使用同一 `wp-element` Runtime、定义 Versioned Contract、Failure Isolation、Package Test 和 Compatibility Policy 时才成立；当前 Toolbar Registry 不隐含这种能力。

## 十五、组件组合与 API

- Props 表达用户意图，不暴露内部 Store Setter 或 Adapter；
- 结构或行为不同的 Variant 使用 Discriminated Union；
- `disabled`、`required`、`readOnly` 等原子布尔语义可以保留；
- 避免组合出 Impossible State 的多个 Boolean；
- Compound Component 只用于一个真正共享语义状态的控制组；
- Structural Composition 优先 `children` 或命名 Slot；
- Render Function 只在调用方需要实时内部数据时使用；
- Controlled / Uncontrolled Ownership 必须显式，生命周期中不切换；
- 不 Inspect Child Type、任意 Clone Child 或修改 Child Props 建立隐藏协议；
- Error Boundary 只隔离可独立恢复区域，并以区域 Owner Identity Reset；
- Error Boundary 不捕获 Event Handler、普通 Async Callback 或 Port Result，相关失败必须进入显式 State 和 Diagnostics；
- Fallback 不宣称外部操作成功，不静默丢弃可保留的未保存内容，也不形成自动 Remount Loop。

## 十六、UI、无障碍与样式

无障碍是 Component API 的一部分：

- 优先 Native Semantic Element；
- Native Button 和 Link 的标准键盘激活由 User Agent 提供，不重复添加会再次触发 Click 的合成键盘 Handler；
- Custom Widget 必须实现并测试对应 WAI-ARIA Pattern 的完整键盘合同，不能只补 Enter / Space；
- 每个 Control 有 Accessible Name；
- Icon-only Button 有明确 Label；
- Decorative Icon 对辅助技术隐藏；
- Form Label、Help 和 Error 正确关联；
- 保留 Visible Focus；
- Color 不是唯一状态信号；
- Dialog 有 Label、Focus Containment、Escape Contract 和 Focus Return；
- Destructive、Publishing、Unsaved 或 In-progress Dialog 不因误触 Backdrop 关闭；
- Toolbar、Menu 和 Split Pane 可通过键盘操作；
- Shortcut 尊重 IME Composition；
- Pointer Capture 在 Cancel 和 Teardown 释放；
- 验证 Long Translation、RTL、200% Zoom、Reduced Motion、Forced Colors 和 High Contrast；
- 不移动 Focus 的 Pending、Progress、Success 和 Error 状态通过适当 Status / Alert / Live Region 可编程播报；
- 避免对每次 Keystroke 或 Preview 更新进行噪声播报；
- `useId` 只用于本地 Label / Description / Help / Error 关联，不用于 List Key、持久化 ID、公共扩展 ID、CSS Selector、Handle 或 Storage Key。

样式规则：

- Admin CSS 作用域位于稳定 EasyMDE Root；
- Root Layout、Feature Style 和 Shared UI Style 分别由各自 Owner 管理；
- 不覆盖广泛 WordPress Admin Element；
- 不用任意 Offset、宽泛 `!important` 或 Child Patch 掩盖错误 Parent Layout；
- 使用 Logical Property、Project Token 和受控 Z-index Scale；
- Admin Token 与公开文章 Theme CSS 分离；
- DOM Order 与 Keyboard / Reading Order 一致。

## 十七、性能与 Bundle

性能从测量开始，不从 `memo()` 开始。

重点指标：

- 大文档 Keystroke Latency；
- Preview Scheduling 和 Completion；
- Mount-to-ready；
- Toolbar 和 Dialog Interaction；
- Outline 和 Revision Rendering；
- 重复 Mount / Unmount 后 Memory、Listener、Observer 和 Timer；
- Initial Entry 和 Optional Chunk Size；
- Duplicate Dependency 和 Private React Runtime。

规则：

- Session Markdown 立即更新；
- Debounce Preview 和昂贵派生工作，不 Debounce Controlled Input 或 Submission Bridge；
- 订阅最小 State Slice；
- 不让多个 Feature 每次击键重复解析整篇文档；
- `memo`、`useMemo`、`useCallback` 只在测量或身份合同需要时使用；
- `startTransition()` 不包裹 Editor Value、Submission Bridge、Save / Publish、Focus 或无障碍关键状态；
- `React.lazy()` 只用于可选重型 UI，并提供可访问 Fallback；
- 不把 Suspense 当作隐式 WordPress Data Layer；
- 不在无证据时引入 Virtualization、Worker、`content-visibility` 或性能库。

## 十八、构建、依赖和发布包

使用根 npm Project 和 Vite。Source 位于 `frontend/`，Runtime Output 位于 `assets/build/`。Vite Build 不是 Type Check，`tsc --noEmit` 是独立门槛。

首个 Build Implementation 记录并固定选定的 Vite、TypeScript、Node 和 npm Version、Browser Target、WordPress Loading Strategy、JSX Runtime Mapping、Dev Server Boundary 和 Release Output Contract。Browser Target 由 EasyMDE / WordPress 支持范围与实际测试矩阵决定，不由 Vite 默认值静默决定。Global Polyfill 必须有明确浏览器需求、作用域、体积和移除条件。

编译期 Package 与类型声明不能暴露高于最低运行时的 API。React / ReactDOM 的测试依赖、`@types/react`、`@types/react-dom`、`@wordpress/element` 与 JSX Runtime Type 必须和 WordPress 6.7 已核验的 React 18 能力对齐；针对 React 19 或更新 Gutenberg Package 的 Type Check 通过，不代表 WordPress 6.7 运行兼容。

实时 `package.json` 尚未提供 React、TypeScript、Vite、Type Check、Lint 或 Frontend Build Script。首个聚焦 Frontend Build Implementation 必须先加入并实际执行适用 Gate，不能把本文批准的目标能力误报为现有工具能力，也不能假定当前 Legacy Package Check 已覆盖新目录。该任务必须更新实时 Release Owner、Package Predicate 和 Test，使新的 Frontend Layout 同时遵守安装版 ZIP 与 Source Archive 的既有产品边界；聚焦 Frontend Package Impact 的执行合同属于 `.agents/skills/easymde/SKILL.md`，准确的当前 Include / Exclude、构建和验证行为属于 `docs/TESTING_AND_RELEASE.md`、`scripts/build-release.mjs` 与 `scripts/build-source-archives.mjs`。

首个 Build Implementation 必须选择并验证一个一致策略：

- Classic WordPress Script；或
- WordPress Script Modules / ESM。

不得同时宣称 IIFE 和普通 Dynamic Chunk 可用而没有 Loader Contract。

WordPress 6.7 默认把 `@wordpress/element` 注册为 Classic `wp-element` Script Dependency，并未把 `@wordpress/element` 注册为默认 Script Module。选择 Script Module / ESM 时必须显式证明一个本地 Bridge 复用同一个 `wp-element` Runtime，并验证 Load Order、JSX Runtime Identity、Dependency Metadata、Translation 和 Teardown；无法证明时使用 Classic Script，不得私自打包 React，也不得假设 Core 已提供对应 Import Map Entry。

所有策略都必须：

- 使用 WordPress React Runtime；
- 正确 Externalize 或 Map `react`、`react-dom`、`@wordpress/element` 和 JSX Runtime；
- 生成并验证 Manifest 与 Dependency Metadata；
- 保持 Primary Handle 稳定；
- 仅在 Manifest-backed Loader 支持时使用 Content Hash Chunk；
- 从 Plugin Asset Base 解析 Chunk；
- 失败于 Missing、Stale、Duplicate 或 Inconsistent Manifest；
- 失败于任何 Production Entry 包含 Private React；
- 排除 Dev Server URL、Localhost、Source Path、未批准 Source Map、未批准或发行渠道不兼容的 Remote Runtime Resource 和 Development Code；
- HMR / Fast Refresh 只用于开发体验，Full Reload、重复 Mount / Unmount 和 Production Build 必须同样正确。

依赖必须有当前 Owner、非重复责任、可接受 License、直接和传递体积、活跃维护、无禁止 Telemetry / Remote Runtime、测试、移除策略、Lockfile 更新和 Third-party Notice。

### 资源交付与发行渠道

本地、版本控制内的运行时资源是默认方向，因为它让编辑器在安装包内自包含，使版本、License、完整性、隐私、离线与失败行为、更新责任和可复现发布都能由项目直接控制。当前实现仍使用本地资源；本文不代表项目已经采用 CDN，也不批准任何具体远程 URL。

远程交付不是全局开关。只有一个聚焦 Feature 的单个资源，在人工明确批准且逐项证明官方来源、长期可靠性、不可变 HTTPS 身份、License、隐私、完整性、失败与 Fallback、更新 Owner、移除策略及目标发行渠道兼容后，才可以被考虑。未知 Host、非官方 Mirror、可变 URL、浮动版本、个人域名、Proxy、Tracking、Telemetry、静默换源和远程可变 Executable Code 不属于可接受方向。

技术可信与发行许可是两个独立问题。GitHub Releases、Private Deployment、Self-hosted Package 或其他经过审查的渠道，可以按自身合同评估同一个技术 Gate；一个渠道的结论不能自动扩展到另一个渠道。WordPress.org Plugin Directory 对普通非服务型 JavaScript、CSS 和其他运行时代码有自己的当前官方规则；官方来源、固定版本、SRI 或维护者批准不能覆盖这些规则。真正的 External Service 必须提供实际服务能力，并单独满足 Readme、Privacy、Consent 和数据披露要求。Remote Font 或 Font CDN 是独立分类，必须依据当前官方规则和例外逐项核对 Official Source、Exact Version / URL、License、Data / Privacy、SRI / `crossorigin`、Failure / Fallback、发行渠道接受状态和人工批准；证据不足时保持本地。其他声称的例外同样单独核对，分类不明确时交由 Plugin Review Team 判断。

逐资产 Decision Record、SRI / CORS / CSP / MIME / Redirect / Cache / Referrer、数据发送、Fallback、批准、复审触发器和实施验证属于 `.agents/skills/easymde/SKILL.md`，不在本文复制执行清单。当前架构事实仍由 `docs/ARCHITECTURE.md` 记录，测试和发布命令仍由 `docs/TESTING_AND_RELEASE.md` 负责。

安装版 ZIP 必须包含完整运行时、Composer Runtime Dependency、License、翻译和 Notice，同时排除开发源码、测试、Cache、私有或机器相关数据及无关开发产物。准确的当前 Include / Exclude、构建与验证行为属于 `docs/TESTING_AND_RELEASE.md`、`scripts/build-release.mjs` 和 `scripts/build-source-archives.mjs`；本文只保留长期产品边界，不维护第二份会漂移的逐路径执行清单。

安装版 ZIP 与 Source Archive 是不同产品：

- 安装版 ZIP 使用运行时 Allowlist，不包含 Frontend Source；
- Source ZIP / tar.gz 可以包含仓库策略明确跟踪的 `frontend/` Source、构建维护文档和运行时输出。

不得把安装包 Allowlist 套用到 Source Archive；准确的 Commit 输入、生成和拒绝规则属于 `scripts/build-source-archives.mjs` 与 `docs/TESTING_AND_RELEASE.md`。

## 十九、测试与维护

测试按责任选择：

- `domain`：纯规则和边界；
- `contracts`：Schema Version、PHP / TS Fixture、Error Mapping 和 Safe Value；
- `integrations`：WordPress DOM、Native Form、Nonce Refresh、Lock、REST、Media、Storage、Clipboard 和 Cleanup；
- `features`：通过 Mock Runtime 验证 Controller、Hook 和 UI；
- `app`：Error Boundary、Activation、Teardown，以及该 Root 确实拥有时的 Provider 和 Store；不得为结构对称创建测试专用 Store / Provider；
- E2E：安装版 ZIP 上的真实 WordPress Author Flow。

准确的 Release 与 Source Archive 测试属于 `docs/TESTING_AND_RELEASE.md`、
`scripts/build-release.mjs` 和 `scripts/build-source-archives.mjs`；聚焦
Frontend Package Impact 的测试选择属于 `.agents/skills/easymde/SKILL.md`。

测试质量：

- Component Test 优先通过 Accessible Role、Name、Label 和用户动作交互，不依赖 CSS Class 或私有 DOM；
- Snapshot 只能补充结构证据，不能独立证明 Interaction、Focus、Failure 或 Accessibility；
- E2E 使用语义 Ready Condition，不使用固定 Sleep；
- 测试直接执行 Production Domain Function、Parser、Schema 和 Adapter，不复制一份测试专用实现；
- External Store、Async Concurrency、Error Boundary Scope 和 Status Message 都需要最低可靠层级的专门测试；Translation Loading 的完整测试合同属于 `.agents/skills/i18n/SKILL.md`。

工具链存在后自动执行：

- Strict TypeScript 和 `noEmit`；
- Hook、Accessibility 和 Restricted Global Lint；
- Dependency Direction；
- Approved React Runtime Import；
- Manifest、Dependency Metadata、CSS 和 Chunk 校验；
- PHP-to-TypeScript Contract Fixture；
- 聚焦 Frontend Package Impact 对实时 Release Owner 的一致性校验。

### 长期维护

- 架构变化记录 Context、Decision、Alternatives、Consequences 和 Removal / Review Date；
- 稳定规则变化时同步本文与主 Skill；
- 迁移规则只进入 Migration Skill；
- 已过时规则应删除，不为“历史完整”永久保留；
- Public Contract 小而版本化，Concrete Implementation 私有；
- 代码审查关注 Owner、边界、失败行为和证据，不把个人风格当缺陷；
- 不声称未实际执行的 Test、Review、Performance、Accessibility 或 Browser Validation。

## 二十、禁止的架构模式

禁止：

1. Gutenberg Replacement、Next.js、Webpack、另一 Frontend Framework 或替代 Publishing Backend；
2. React 19-only API、Hydration、RSC、Server Actions 或 Private React Runtime；
3. 第二套正式 Markdown Renderer 或 Browser CSS Security Parser；
4. 第二 Canonical Document、Save、Publish、Revision、Media、Settings、Timezone 或 Public Content Authority；
5. Component 直接访问 WordPress DOM、jQuery、`wp.apiFetch`、`wp.media`、Storage、Clipboard 或 Bootstrap Global；
6. Universal Adapter、Generic Command Bus、God Component 或 Shared Mutable Root Store；
7. Circular Dependency、Upward Import、Broad Barrel 或跨 Feature Private Deep Import；
8. Render-time Side Effect、Effect-driven User Command、Mirrored State 或 Impossible Boolean Props；
9. Random Key、Reorderable Domain Data 的 Index Key 或 Nested Component Definition 导致的意外重置；
10. Silent Fallback、Swallowed Error、Fake Success、Hidden Write、Force-click Disabled Control 或 Automatic Mutation Retry；
11. Stale Async Work 更新当前 Post、Root、Dialog 或 Session；
12. Effect 缺少 Cleanup、Idempotence、Failure Handling 或 Repeated Lifecycle Safety；
13. Browser Local Scheduling 覆盖 WordPress Site Timezone；
14. 忽略 Extension Registry 或只支持 Built-in Command；
15. Root-relative Plugin Asset URL、未批准或发行渠道不兼容的 Remote Runtime Resource、Production Dev Server Reference 或未批准 Telemetry；
16. Empty Feature Directory、Placeholder Module、Unused Asset 或无当前 Owner 的 Dependency；
17. 私密正文、Custom CSS、Prompt、Token、Nonce、Credential 或 Secret Endpoint 进入 Diagnostics；
18. Development-only、Private、Machine-specific 或无关 Artifact 进入安装版 ZIP；
19. 把 react-admin、通用 Skill、博客或搜索结果当作高于 EasyMDE 项目证据的规范；
20. 把 Error Boundary 当作 Event、Promise、Timer、Port 或 Mutation 的通用错误处理器；
21. Unstable External Store Subscription、未缓存 Snapshot、重复订阅、轮询或 Effect State Mirroring；
22. 无并发策略、Owner Identity、Stale Result、Cancellation 或权威结果对账的 Async Operation；
23. Duplicate Translation Owner 或绕过 `.agents/skills/i18n/SKILL.md` 执行合同的用户可见文案；
24. 把 Vite Build 当作 Type Check、依赖未审查 Browser Target 或让 HMR 成为正确性前提；
25. 通过公共扩展 Payload 执行任意 JS、传 Raw React Element / Component、暴露内部 Store / Adapter 或依赖 Private DOM。
