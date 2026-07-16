# EasyMDE React 架构规范

本文定义 EasyMDE WordPress 后台 React、TypeScript 与 Vite 应用的长期架构合同。

它记录稳定的设计哲学、目录边界、所有权、依赖方向、接口原则、数据流、运行时、构建、测试和发布决策。开发时的细化检查、代码示例和 Feature 失败路径由 `.agents/skills/easymde/SKILL.md` 与对应 GitHub Issue 补充。

本文不是当前实现清单，也不规定固定开发顺序。当前代码事实始终以实时仓库、根目录 `AGENTS.md` 和 `docs/ARCHITECTURE.md` 为准。任何目录、配置、接口或依赖都只能在真实功能需要时创建。

## 一、资料权威与维护原则

架构和代码规则按以下优先级解释：

1. 当前明确任务、关联 GitHub Issue 和人工维护者决定。
2. 根目录 `AGENTS.md` 与实时仓库中的数据、安全、兼容、扩展、隐私、测试和发布合同。
3. 本文与 `.agents/skills/easymde/SKILL.md`：本文负责长期架构，Skill 负责实施细节。
4. React、WordPress 和 TypeScript 官方文档，以及与最低支持版本匹配的官方源码。
5. 通用 React、组件组合和 Web 设计 Skill。
6. 博客、公众号、搜索摘要和其他二手资料。

二手资料只能提供线索，不能直接成为项目规范。采纳建议前必须确认：

- 规则仍适用于 React 18；
- 规则适用于当前 TypeScript 和类型包；
- 规则符合 WordPress 6.7 或更高版本的实际 API；
- 规则不破坏 EasyMDE 数据、保存、预览、发布、扩展和安装包合同；
- 搜索结果与官方文档或匹配版本的源码一致。

版本敏感结论必须标明适用版本。无法验证时，记录为待确认项，不把猜测写成架构事实。

当本文、Skill 与实时仓库发生冲突时，不得静默选择其中一个。应确认真实项目合同，并在同一任务中同步修正已经过时的文档。

## 二、总体设计哲学

### 1. 系统需求决定工具

React 服务 EasyMDE 的交互需求，而不是取代 WordPress。

React 适合负责声明式界面、组件组合、会话状态和可测试交互；PHP 和 WordPress 继续负责持久化、安全、正式渲染和平台行为。

不得因为某个模式在其他 React 项目流行，就引入新的框架、状态库、表单库、路由、Schema 工具或组件系统。每个工具必须解决当前项目中可以说明、测试和维护的责任。

### 2. 先建模数据和状态，再设计组件树

设计一个页面或 Feature 时，顺序是：

1. 明确用户目标和平台约束；
2. 明确服务端数据、浏览器会话数据和派生数据；
3. 列出加载、空、成功、错误、权限不足、冲突和取消等状态；
4. 为每个状态值指定唯一所有者；
5. 根据用户可理解的职责划分组件树；
6. 先实现由类型化输入驱动的纯渲染；
7. 再通过事件、Command、Port 和显式状态转换加入交互。

禁止先创建通用组件目录、全局 Store 或万能 Service，再寻找使用场景。

### 3. 渲染必须保持纯粹

相同 Props、State 和 Context 应生成相同 JSX。

Render 阶段不得：

- 修改 Props、State、Context 或 Registry；
- 修改 WordPress DOM 或浏览器全局；
- 保存、发布、上传、复制或写 Storage；
- 注册订阅、Timer 或 Observer；
- 发起依赖副作用的网络 Mutation；
- 输出包含文章内容、Nonce 或凭据的诊断。

用户操作在 Event Handler 或明确 Command 中执行。Effect 只用于把 React 状态同步到外部系统，并且必须有单一职责、正确依赖和可重复清理。

### 4. 每个事实只有一个权威所有者

典型所有权：

```text
Canonical Markdown         → PHP 持久化的 _easymde_markdown
当前编辑会话 Markdown      → Editor Store
兼容 HTML                  → PHP MarkdownRenderer + post_content
原生表单序列化             → WordPress Submission Bridge
REST 安全状态              → WordPress + SessionPort
Dialog 尚未提交的草稿      → 最近的 Feature Owner
设置持久化                 → WordPress Options API
公开文章输出               → PHP / WordPress
```

不得为了方便访问，把同一事实复制到 Component State、Context、Store、Query Cache、DOM Field、Storage 和 PHP 中。

### 5. 状态保持最小、无矛盾、可推导

- 同一次原子转换中的值可以组合管理；
- 不能同时成立的状态用 Discriminated Union 表达；
- Dirty、是否可发布、统计结果等可计算事实不重复保存；
- 临时状态放在最近所有者；
- 只有真正需要协调多个消费者时才提升状态；
- 状态重置由实体身份和明确产品规则决定；
- 不通过随机 Key、组件嵌套定义或无意的树位置变化重置状态。

### 6. 边界必须可观察、可失败、可测试

每个外部操作必须有：

- 明确所有者；
- 类型化输入和输出；
- 权限和数据验证；
- 取消、冲突或过期语义；
- 来自真实平台所有者的成功信号；
- 用户可理解的失败状态；
- 不泄露内容和秘密的诊断；
- 最低可靠层级的测试；
- 需要浏览器行为时，对安装版 ZIP 的真实 E2E 验证。

## 三、产品与平台所有权

React 应用覆盖 WordPress 后台中属于 EasyMDE 的交互界面，例如：

- 编辑器工作区；
- 标题和 Markdown 编辑界面；
- 实时预览和大纲；
- 工具栏和 Markdown 操作；
- 布局、主题、字体和自定义 CSS；
- 发布界面；
- 历史版本；
- 媒体选择、上传和图片插入；
- 本地草稿恢复；
- 微信富文本复制；
- 设置页；
- 经独立任务批准的 AI 助手界面。

React 负责：

- 后台 UI 渲染；
- 用户交互；
- 组件组合；
- 对话框、面板和布局；
- 浏览器编辑会话中的临时状态；
- 对外部能力的调用编排；
- 加载、空、错误、权限不足和冲突状态的呈现。

PHP 和 WordPress 继续负责：

- 插件加载、Hook 和服务装配；
- 支持的 Post Type 准入；
- Capability 和 Nonce；
- Post Meta 和 Options API；
- Markdown 正式渲染和 HTML 安全过滤；
- Custom CSS 安全策略；
- 修订版本；
- 媒体库和上传权限；
- 分类、标签和特色图片；
- 原生保存、发布、状态和计划发布时间；
- Autosave、Heartbeat 和文章锁；
- 前台文章、Feed、搜索、邮件和 REST Consumer 需要的兼容 HTML；
- 文章主题和代码主题注册表。

总体数据流：

```text
PHP / WordPress
拥有持久化数据、安全、渲染、保存和发布
                 ↓
Versioned Runtime Contracts + Focused Ports
                 ↓
React Applications
拥有后台界面、交互和浏览器会话状态
```

React 不得创建第二套正式 Markdown Renderer、权限系统、文章保存路径、发布后端、修订模型、媒体存储、设置存储、站点时区模型或前台内容权威。

## 四、安全设计原则

安全边界属于 PHP 和 WordPress，不能只依赖客户端界面。

- Capability Check 决定用户是否有权执行操作；
- Nonce 用于请求完整性和 CSRF 防护，不是授权；
- 每个受保护 REST Route 必须有针对该动作的 `permission_callback`；
- 客户端 Capability 只用于展示和提前反馈；
- 服务端仍验证每个写操作；
- 能精确判断有效性的输入优先 Validation；
- 无法精确 Validation 时再使用适当 Sanitization；
- 输出在最接近输出位置 Escape；
- REST Callback 返回数据、`WP_REST_Response` 或 `WP_Error`，不手动打印 JSON；
- 不把 Raw Server HTML、Stack Trace、Nonce、Cookie、Token 或文章内容作为用户错误消息。

PHP 安全规则不能因 React 提供了类型、Schema 或隐藏按钮而省略。

## 五、React 运行时基线

EasyMDE 支持 WordPress 6.7 或更高版本。

后台应用使用 WordPress 提供的 React 18 Runtime：

```text
@wordpress/element
wp-element
```

挂载规则：

```tsx
import { createRoot } from '@wordpress/element';

export function mountEditor(element: HTMLElement): () => void {
  const root = createRoot(element);
  root.render(<EditorApp />);

  return () => root.unmount();
}
```

必须遵守：

- 从 `@wordpress/element` 使用 React Runtime API；
- 使用 `createRoot`，不添加旧版 `render` 分支；
- 每个 Root 保存并执行 `root.unmount()`；
- 后台 Root 是客户端挂载应用，不使用 Hydration；
- 不在安装包中重复打包 React 或 ReactDOM；
- 不在不同 React Runtime 之间传递 Element、Context、Hook、Portal 或 Ref；
- 不使用 React 19 专属 API；
- 不为 WordPress 6.7 以下版本维护兼容路径；
- 开发环境可以使用 `StrictMode` 暴露不纯渲染和错误清理，不能通过关闭检查掩盖问题。

`@wordpress/components` 不作为 EasyMDE 的第二套默认设计系统。确有需要时，必须验证目标 WordPress 版本的稳定 API、无障碍、视觉合同、依赖和 Bundle 成本。

## 六、仓库与应用目录

只保留一个根 npm 项目和一个 Lockfile：

```text
EasyMDE/
├── easymde.php
├── composer.json
├── package.json
├── package-lock.json
├── src/                         PHP 生产代码
├── includes/                    PHP 兼容入口
├── templates/                   PHP 模板
├── frontend/                    React / TypeScript 源码
├── assets/                      插件运行时资源和编译产物
├── scripts/                     构建、发布、i18n 和校验脚本
├── languages/
├── tests/                       PHP、Node 和 E2E 测试
└── docs/
```

禁止创建：

```text
frontend/package.json
frontend/package-lock.json
```

两个 npm 项目会制造依赖、版本、License、CI 和发布图漂移。

默认 React 目录：

```text
frontend/
├── vite.config.ts
├── vitest.config.ts          # 仅在 Vitest 真正引入时创建
├── tsconfig.json
├── eslint.config.js          # 仅在 ESLint 真正引入时创建
└── src/
    ├── entrypoints/
    │   ├── admin-editor.tsx
    │   └── settings.tsx
    ├── app/
    │   ├── editor/
    │   │   ├── EditorApp.tsx
    │   │   ├── EditorProviders.tsx
    │   │   ├── EditorErrorBoundary.tsx
    │   │   ├── createEditorStore.ts
    │   │   ├── store/
    │   │   └── styles/
    │   └── settings/
    │       ├── SettingsApp.tsx
    │       ├── SettingsProviders.tsx
    │       ├── SettingsErrorBoundary.tsx
    │       ├── createSettingsStore.ts
    │       ├── store/
    │       └── styles/
    ├── contracts/
    │   ├── bootstrap/
    │   ├── ports/
    │   ├── errors.ts
    │   ├── safe-html.ts
    │   ├── editor-runtime.ts
    │   └── settings-runtime.ts
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
    │   │   ├── save/
    │   │   ├── session/
    │   │   ├── publishing/
    │   │   ├── revisions/
    │   │   ├── media/
    │   │   ├── settings/
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
    │   ├── lib/
    │   └── types/
    └── test/
        ├── setup.ts
        ├── fixtures/
        ├── factories/
        └── mock-runtime/
```

这是所有权地图，不是批量建目录清单。不得创建空目录、空 `index.ts`、占位组件、未来 AI 文件或没有当前职责的抽象层。

## 七、应用 Root 和 Entrypoint

每个真实 WordPress 页面或独立应用面拥有自己的 Entrypoint、Runtime、Store、Provider、Error Boundary 和生命周期。

```text
entrypoints/admin-editor.tsx
→ app/editor/*

entrypoints/settings.tsx
→ app/settings/*
```

禁止把 Editor 与 Settings 放入共享的：

```text
app/store/
app/providers/
```

Editor 和 Settings 可以共享纯 Domain、Contracts 和 UI Primitive，但不共享可变 Store、Query Cache、Error Boundary 状态或 Lifecycle Owner。

Entrypoint 只负责：

- Root 定位和验证；
- Bootstrap Contract 解析；
- Runtime 和 Store 创建；
- React Mount；
- Ready 后激活所有权；
- 启动失败报告；
- 完整 Teardown。

Entrypoint 不包含 Feature 业务、REST 实现、WordPress Selector、主题规则、发布规则、Dialog State 或大段 JSX。

启动失败时必须保留之前可用的 Owner，或显示明确的 Fatal State。React Ready 之前不得隐藏旧 Owner。

## 八、分层职责与依赖方向

### `app/`

负责某个 Root 的 Shell、Provider、Error Boundary、Store 创建、顶层布局和生命周期。

### `contracts/`

定义 PHP、WordPress、浏览器和 React 之间稳定、可验证的边界：

- Bootstrap Schema；
- Runtime Ports；
- REST Request / Response；
- Operation Result；
- Stable Error Code；
- Safe HTML Brand；
- Extension Contract；
- Browser Storage Payload；
- Build Manifest 和 Asset Metadata。

TypeScript Interface 不能验证运行时数据。所有外部数据必须在边界 Parse。

### `domain/`

只包含纯业务规则，不依赖 React、JSX、DOM、WordPress Package、Browser Global、Network、Feature UI 或 Concrete Adapter。

### `features/`

按用户可理解的能力组织，而不是按技术类型组织：

```text
workspace
title-editor
markdown-editor
live-preview
outline
toolbar
appearance
custom-css
publishing
revisions
media
local-drafts
wechat-export
settings
ai-assistant
```

### `integrations/`

集中 WordPress、REST、DOM、Native Form、Media、Storage、Clipboard、Preview Enhancement 和 Diagnostics 访问。

WordPress 子目录必须对应明确 Port。禁止通用 `editor/`、`api/`、`WordPressService` 或超大 `EditorAdapter`。

### `shared/`

只包含没有 EasyMDE Feature 所有权、没有 WordPress 业务决策的通用 UI、Hook、Icon、Pure Utility 和 Type。

依赖方向：

```text
entrypoints  → app, contracts, integrations
app          → features, contracts, shared
features     → domain, contracts, shared
domain       → shared pure utilities and types only
contracts    → domain types and shared types only
integrations → contracts, domain, shared
shared       → no app, Feature, integration, or WordPress ownership
```

Circular Import、Upward Import、Feature 私有深层导入和 Feature 内构造 Concrete Adapter 都是架构缺陷。前端 Lint 工具链建立后必须自动检查依赖方向。

## 九、Feature 与组件边界

一个组件应有明确的语义责任、状态或无障碍合同、可复用边界或可独立恢复的失败边界。

不要把每个 Wrapper 都拆成组件，也不要让一个组件同时承担布局、数据权限、REST、WordPress DOM、状态机和多组不相关交互。

大型 Feature 可以使用：

```text
features/publishing/
├── ui/
│   ├── PublishDialog.tsx
│   ├── PublishSettings.tsx
│   └── CategoryTree.tsx
├── model/
│   ├── usePublishDraft.ts
│   ├── usePublishAction.ts
│   └── publishing-state.ts
├── styles/
│   └── publishing.css
├── publishing.types.ts
└── index.ts
```

规则：

- `ui/` 负责渲染和直接交互；
- `model/` 负责 Feature State 和 Port 调用编排；
- 可脱离 React 的规则放入 `domain/`；
- 外部系统实现放入 `integrations/`；
- `index.ts` 只暴露明确 Named Export；
- 禁止 `export *`；
- 其他 Feature 只能导入公共 API；
- Feature 内部不得从自己的 `index.ts` 反向导入；
- 只有稳定、真实跨 Feature、无业务所有权的代码才能进入 `shared/`。

组件 API 设计：

- Props 表达用户意图和组件合同，不暴露内部实现步骤；
- 结构或行为显著不同使用显式 Variant 或 Discriminated Union；
- `disabled`、`required`、`readOnly` 等原子状态可以使用 Boolean；
- 禁止多个 Boolean 组合出不可能状态；
- Compound Component 只用于真正共享语义和局部状态的一组控件；
- 静态结构优先使用 `children`；只有调用方需要内部实时数据时才使用 Render Function；
- Controlled 与 Uncontrolled 模式必须明确，生命周期中不能切换；
- Shared UI 不知道 Post ID、Capability、WordPress Selector、Endpoint 或 EasyMDE 业务规则；
- 不通过检查 Child Type、任意 `cloneElement` 或修改 Child Props 建立隐藏协议；
- WordPress 页面导航仍由 WordPress 管理，Tabs、Panel 和 Dialog 不构成引入 Router 的理由。

## 十、TypeScript 设计和命名

### Compiler 基线

前端工具链建立时从严格模式开始：

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "useUnknownInCatchVariables": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true
  }
}
```

`exactOptionalPropertyTypes` 需要结合实际 React 和 WordPress 类型包验证后决定。不能因为单个依赖问题关闭全局严格模式。

### 类型规则

- 不可信边界使用 `unknown`，Parse 或 Narrow 一次；
- `any` 不能代替验证；
- 局部明显变量、JSX Event 和私有 Helper 可使用推断；
- Port、导出 API、Schema Parser 和跨边界 Async Function 使用明确返回类型；
- Operation State、Result 和互斥 Props 使用 Discriminated Union；
- Closed Union 使用 Exhaustive Switch；
- 不允许调用方修改的 Snapshot 和输入使用 `Readonly` / `ReadonlyArray`；
- Brand/Opaque Type 只用于确实有运行时来源意义的值；
- Utility Type 用于局部转换，不用复杂 `Pick` / `Omit` 链隐藏长期 Domain 语义；
- Registry、Config 和 Fixture 可用 `satisfies` 保留 Literal Inference；
- 避免 Non-null Assertion，先验证再传递 Narrowed Value。

### `type` 与 `interface`

项目约定按意图选择：

- `type`：封闭的 Component Props、Union、Tuple、Alias、Mapped Type 和 Feature-local Model；
- `interface`：有意扩展的 Port 或公共 Adapter Object Contract；
- 不依赖 Declaration Merging，除非扩展性本身是公开合同。

### Function Component

普通函数组件是默认写法，Props 显式声明。默认不使用 `React.FC`。

该约定不是建立在“现代 React.FC 必然隐式添加 children”这种不可靠说法上，而是因为普通函数：

- Props 更直接；
- `children` 是否存在更明确；
- Generic Component 更自然；
- 减少无意义的 Component Type 包装。

一般可渲染 `children` 使用 `React.ReactNode`。只有明确的 Render Callback 才使用函数类型。

### 原生元素 Props

可复用 UI Primitive 可以扩展对应原生元素类型，例如 `React.ComponentPropsWithoutRef<'button'>`。必须：

- 保留原生语义和事件类型；
- 用 `Omit` 明确解决冲突；
- 表单中的普通按钮默认 `type="button"`；
- 不把任意 DOM Props 盲目 Spread 到非原生 Wrapper 或多个元素。

### Event、State、Ref 和 Hook

- JSX 附近的 Handler 优先使用 Contextual Typing；
- Event 不使用 `any`；
- `useState` 对明确初始值使用推断；
- `null`、空数组、空 Map 或 Union 初始值显式声明类型；
- DOM Ref 使用 `useRef<HTMLElementType>(null)`；
- 非渲染可变值使用明确的 `T | null` 或实际初始值；
- Ref 不是 Render State 或第二套 Document Authority；
- Custom Hook 共享有状态逻辑，不共享 State Instance；
- Hook 名称表达具体目的，不使用模糊生命周期名称；
- 对象返回适合可演进的 Named Field；Tuple 只用于稳定位置语义；
- Generic Component 需要至少两个具体需求证明共同语义，不能提前建设万能 List、Table 或 Form。

### 命名

```text
Directories              kebab-case
React components         PascalCase.tsx
Error boundaries         PascalCase.tsx
Hooks                    useFeatureName.ts
Pure function modules    camelCase.ts
WordPress adapters       PascalCase.ts
Port files               feature-port.ts
Type modules             feature.types.ts
CSS files                kebab-case.css
Tests                    source-name.test.ts or SourceName.test.tsx
```

名称表达领域意图，不使用 `Manager`、`Service`、`Helper`、`Util`、`Data`、`Thing` 等无法说明责任的宽泛名称。

Comment 解释所有权、安全、兼容、不变量和非显然失败行为，不复述 JSX。

## 十一、状态、身份与生命周期

每个应用 Root 使用独立 Store，不导出全局可变 Singleton。

Editor Store 可按责任组织：

```text
document    # Markdown、标题、Saved Baseline、Dirty、Selection Metadata
appearance  # 文章主题、代码主题、字体、自定义 CSS 选择
layout      # View、Pane Ratio、Outline、Panel
session     # Operation、Error、Capability、Post Identity、Lock
```

规则：

- 临时输入、Hover、未确认 Dialog Field、局部 Validation 和 Drag State 留在最近 Owner；
- 跨 Feature 的编辑会话状态进入 Editor Store；
- REST Collection 由单一 Server-state Owner 管理；
- Dirty 和其他派生事实不重复保存；
- 不通过 Effect 镜像 State；
- Saved Baseline 只在真实 WordPress Save 成功后前进；
- Post-scoped State、Cache、Operation ID 和 Storage Key 包含 Site、User 和 Post Identity；
- 新文章获得真实 ID 时显式 Re-key 或清理状态；
- Domain Item 使用稳定 Key；Reorderable 数据禁止 Index Key；
- Key 重置 Subtree 必须是明确的 Owner Identity 规则；
- 不在 Render 内定义会导致子组件身份不断变化的 Component Function；
- Storage 只保存获准的 Preference 或 Recovery Data，并有 Version 和 Conflict Policy。

Effect 只同步外部系统，不能用于：

- 计算 Renderable Derived Data；
- Copy Props to State；
- Mirror Store Value；
- 间接处理 Button Click；
- 因 Boolean 变真而自动触发 Mutation；
- 执行可以通过 Lazy Initializer 完成的初始化。

每个 Effect 必须有单一外部责任、正确 Reactive Dependency、Setup、Idempotent Cleanup 和 Failure Path。

## 十二、Port 与接口设计哲学

Feature 依赖能力，不依赖 WordPress Global、DOM Selector 或 Transport 细节。

```ts
export interface EditorRuntime {
  document: DocumentPort;
  save: SavePort;
  session: SessionPort;
  preview: PreviewPort;
  appearance: AppearancePort;
  publishing: PublishingPort;
  revisions: RevisionPort;
  media: MediaPort;
  storage: StoragePort;
  clipboard: ClipboardPort;
  diagnostics: DiagnosticsPort;
}
```

代表性合同：

```ts
export interface DocumentPort {
  readNativeSnapshot(): Readonly<NativeDocumentSnapshot>;
  synchronizeSubmissionBridge(
    snapshot: Readonly<DocumentSubmissionSnapshot>,
  ): void;
  applyEditorTransaction(
    transaction: Readonly<DocumentTransaction>,
  ): DocumentTransactionResult;
}

export interface SavePort {
  request(
    request: Readonly<{ kind: 'draft' | 'update'; operationId: string }>,
  ): Promise<SaveResult>;
  subscribe(listener: (event: SaveEvent) => void): () => void;
}

export interface SessionPort {
  getSnapshot(): Readonly<SessionSnapshot>;
  subscribe(listener: (event: SessionEvent) => void): () => void;
}
```

接口原则：

- Method 名称表达项目意图，不用通用 `execute(type, payload)` 或无语义 `request()` 包揽所有能力；
- Command 与 Query 在概念上分开；
- 多个相关参数或未来可能扩展的参数使用 Options Object；
- 避免 Boolean Parameter，使用 Named Option 或 Discriminated Union；
- 返回 Immutable Snapshot，不暴露内部可变引用；
- 预期中的 Cancel、Validation、Conflict、Permission 和 Unavailable 使用 Typed Result；
- Throw 保留给 Programmer Defect 或无法正常表达的异常基础设施失败；
- Server Code、HTTP Status 和 Translated Message 分离；
- 可取消 Async API 接受 `AbortSignal`；
- Subscription 返回 Idempotent Unsubscribe；
- 一个 Port 代表一个外部系统责任；
- Port 不暴露 Concrete Store、REST Client、DOM Node 或 WordPress Global；
- Adapter 对 Port Contract 测试，Feature 对 Mock Port 测试。

禁止 Universal Adapter、Generic Event Bus、Stringly Typed Command 和万能 WordPress Service。

## 十三、Bootstrap、REST 和跨语言合同

TypeScript Interface 不会验证 PHP、REST、Storage、Manifest 或 Extension Data。

下列边界使用 Versioned Runtime Schema：

- Editor / Settings Bootstrap；
- REST Request / Response；
- Extension Command 和 Shortcode Helper；
- Browser Storage Payload；
- Build Manifest 和 WordPress Asset Metadata。

规则：

- Mount 和受保护操作前验证必需字段；
- 未知 Optional Field 可以忽略；不兼容 Version 必须明确失败；
- 旧 Consumer 无法安全解释时才升级 Version；
- 不在原字段上静默改变语义；
- Endpoint、Limit、Locale、Direction、Timezone、Storage Identity 和 Feature Availability 属于明确合同；
- 不序列化 Credential、Cookie、Private Config、无关 User Data 或页面不需要的 Article Content；
- Component 不直接读取 Global Bootstrap；
- PHP Fixture 与 TypeScript Runtime Schema 进行跨语言一致性测试；
- 当前 WordPress REST Schema 和项目 Fixture 是权威；不因为通用文章推荐就引入 OpenAPI、GraphQL Codegen、tRPC 或 Schema Library。

REST Client 位于 Integration 层：

- 使用验证过的 Same-origin Endpoint；
- 获取 WordPress 当前 Nonce；
- 可使用 `@wordpress/api-fetch`，但不能把它暴露给 Component；
- Nonce Middleware 需要在 WordPress 提供新 Nonce 时更新；
- Cancellable Read 传递 `AbortSignal`；
- `WP_Error`、HTTP、Malformed JSON、Network、Timeout 和 Abort 被标准化成 Typed Result；
- 只允许有界、可取消的 Idempotent Read Retry；
- Save、Publish、Delete、Settings、Upload、CSS Write 和 Revision Restore 不自动 Retry；
- 逻辑不依赖 Translated Message。

## 十四、持久化和兼容合同

受保护 Post Meta：

```text
_easymde_enabled
_easymde_markdown
_easymde_markdown_theme
_easymde_code_theme
_easymde_custom_css_id
_easymde_custom_css_snapshot
_easymde_custom_font
_easymde_windows_font
_easymde_apple_font
_easymde_serif_font
_easymde_render_signature
```

规则：

- 未经明确兼容方案和测试，不重命名、删除、重新解释、提前初始化或静默失效；
- `_easymde_markdown` 是 Canonical Markdown；
- `post_content` 是 PHP 生成并清洗的兼容 HTML；
- `_easymde_enabled` 描述已保存状态，不决定 Editor Admission；
- `easymde_supported_post_types` 和 `PostModeController` 决定准入；
- 普通支持文章首次打开时只在内存中获得兼容 Markdown，执行零写入；
- 不增加浏览器 HTML-to-Markdown 权威；
- Empty Markdown 是合法状态，保持 `metadata_exists()` 语义；
- 下一次合法 Save 才写入 EasyMDE Meta 并同步 `post_content`；
- `_easymde_render_signature` 只是内部一致性标记；
- Revision Restore 同时恢复 Markdown 和 Appearance，再由 PHP 生成兼容 HTML；
- `_easymde_code_mac_style` 和历史 `codeMacStyle` 只作为非活跃历史数据保留。

现有 Facade、Filter、Route、Script Handle、Extension Registry、Stable ID、Ordering、Collision Semantics、DOM Bridge Name 和 Observable Behavior 只有在明确 Issue 中才能改变。

## 十五、原生保存、Autosave、Lock 和 Nonce

WordPress 原生表单仍是文章提交合同：

```text
PHP Initial State
→ Validated Bootstrap
→ Root Store
→ User Transaction
→ Synchronous Native Submission Bridge
→ WordPress Native Save / Publish
→ PHP Persists Markdown and Compatibility HTML
→ Adapter Observes Real Result
→ Store Advances Saved Baseline
```

规则：

- 接受 Document Transaction 后立即同步 Native Field，或确保在 Native Serialization 前同步；
- 不留下 Debounce 窗口让 Save、Autosave 或 Unload Check 读取旧值；
- React 不生成或验证 PHP Save Nonce；
- Autosave 和 Revision Activity 不自动等于 Canonical EasyMDE Save；
- React Dirty State 与 WordPress Form Dirty State 使用同一 Saved Baseline；
- 避免双重 Unload Prompt 和重复 Submission；
- Success 以真实 Navigation、Redirect、Native Status 或 Server Confirmation 为准；
- Disabled、Missing、Replaced 或 Extension-modified Native Control 是 Preflight Failure；
- 禁止 Force Click Disabled Control；
- 保持 Heartbeat、Post Lock、当前 Nonce 和 Authentication State；
- REST Nonce 不能作为永不变化的启动常量；
- Invalid Nonce 或 Authentication Expiry 停止操作，不使用相同 Token 重试写入；
- Lock 或 Capability 丢失时停止 Mutation、取消 Pending Work、保留未保存内容并说明原因；
- Scheduling 使用 WordPress Site Timezone 和 Native Field。

## 十六、预览与安全 HTML

正式路径：

```text
Markdown
→ PreviewPort
→ POST /easymde/v1/preview
→ PreviewController 验证 Request 和 Permission
→ MarkdownRenderer 生成并清洗 HTML
→ MarkdownFeatureDetector 检测 Enhancement Feature
→ PreviewController 返回 { html, features }
→ React Preview Surface
→ Local Progressive Enhancement
```

`MarkdownRenderer` 不负责 Feature Manifest。`PreviewController` 组合 Renderer Output 和 Detector Result。

只有通过正式 Preview Contract 的 Server HTML 可以构造成 Branded Safe Value，并进入唯一的 Preview-owned HTML Sink。

Markdown、AI Output、Error HTML、Custom CSS、Extension Data 和 Storage Value 不直接进入 `dangerouslySetInnerHTML`。

Preview Request 支持 Abort、Request Identity、Stale Result Rejection、Payload Limit 和明确 Failure State。Enhancement Failure 保留 Sanitized HTML。Cleanup 移除 Generated Node、Observer、Listener 和 Temporary Asset。

禁止第二套正式 Markdown Renderer 和 Silent Approximate Fallback。

## 十七、关键 Feature 边界

### Markdown Editing

保留 Selection Start / End / Direction、IME、Undo / Redo、Focus、Scroll、Clipboard 和 Shortcut。正常 Render 不重建 Editor Instance。Programmatic Edit 使用明确 Transaction 和可预测 Undo。

### Publishing

React 只拥有临时 Publish Draft。WordPress 拥有真实 Field 和最终 Publish。Cancellation 零写入；Success 以真实 WordPress Result 为准。

### Revisions

WordPress 拥有 Revision Identity 和 Persistence。Restore 同时恢复 Markdown 和 Appearance，再由 PHP 生成 Compatibility HTML。

### Media

通过 `MediaPort` 使用 WordPress Media Library 和 Upload。Cancellation 零写入。Upload 成功且原 Transaction 仍有效后才插入 Markdown。恢复 Selection / Focus，释放 Object URL，失败不留下 Fake Attachment。

### Themes and Custom CSS

Theme Choice 来自 PHP Registry。`CustomCssPolicy` 负责 Permission、Parsing、Selector Scope、Blocked Token、Remote Loading、Size Limit 和 Nested At-rule。Browser Preview 不是第二安全 Parser。

### Settings

Settings 使用独立 Root 和 Store。`manage_options`、Options API、`register_setting()` 和 PHP Sanitization 保持权威。

### Local Drafts

Local Draft 是 Recovery Data，不是 WordPress Save。Key 包含 Site、User、Post Identity，Payload 有 Version，不保存 Nonce、Credential 或 Provider Token，也不静默覆盖更新的 Server Document。

### WeChat Export

只复制当前成功、稳定、已清洗的 Preview。Clipboard Rejection 是真实失败。Legacy Fallback 恢复 Selection、Range、Focus、Scroll 和临时 DOM。

### AI Assistant

AI 只在明确任务中建立。Credential 和 Private Endpoint 留在 Server；Context Scope 可见且最小；Stream 可取消；生成修改是可预览、可拒绝、可撤销的 Document Transaction。AI 不自动保存、发布、上传、修改设置或执行返回的代码与 URL。

## 十八、无障碍与 UI 合同

无障碍属于组件合同：

- Action 使用 `<button>`，Navigation 使用 `<a>`；
- 优先使用 Native Form Control；
- 每个 Interactive Control 有 Accessible Name；
- Icon-only Button 有显式 Label；
- Decorative Icon 对辅助技术隐藏；
- 保留 Visible Focus；
- Color 不是唯一状态信号；
- Label、Help、Error 和 Invalid State 正确关联；
- Validation 或 Network Failure 后保留用户输入；
- Pending 只阻止重复 State-changing Action，不无理由禁用整个页面；
- Dialog 有 Label、Focus Containment、安全 Escape 和 Focus Return；
- Publishing、Unsaved、Destructive 或 In-progress Dialog 默认不允许误触 Backdrop Close；
- Toolbar Command 保留 Selection 并恢复 Focus；
- Shortcut 尊重 IME；
- Split Pane 支持 Pointer 和 Keyboard，并在取消时释放 Pointer Capture；
- 相关界面测试 Zoom、Text Scaling、Long Translation、RTL、Reduced Motion、Forced Colors 和 High Contrast。

Admin CSS 限定在稳定 EasyMDE Root 下。不覆盖 WordPress Admin Global Element，不用无关 Legacy Class 捷径，不用 Arbitrary Offset 和 Broad `!important` 隐藏错误 Parent Layout。

Design Token、Z-index、Icon 和 Asset 必须有项目所有权。Admin Token 与 Public Article Theme 分离。

## 十九、React 18 性能原则

性能优化必须服务实际瓶颈：

- Session Markdown 立即更新；
- Debounce Preview 和昂贵 Derived Work，不 Debounce Controlled Input 或 Submission Bridge；
- 订阅最小 State Slice；
- Render 或 Pure Selector 计算 Derived Value；
- 不为每个 Feature 独立重复 Parse 全文；
- Expensive Initial Value 使用 Lazy Initialization；
- 依赖 Previous State 时使用 Functional Update；
- Ref 只保存不影响 Render 的临时值；
- 不默认到处使用 `memo`、`useMemo`、`useCallback`；
- 优化来自 Measurement 或明确 Identity Contract；
- `startTransition()` 不包裹 Editor Value、Submission Bridge、Save / Publish、Focus 或 A11y-critical State；
- `React.lazy()` 只用于可选重型 UI，并提供 Accessible Fallback；
- Suspense 不作为隐式 WordPress Data Layer。

独立且已授权的 Read 可以并发；Dependent Read 和 Mutation 保持顺序。Obsolete Work 必须 Abort，Stale Completion 不得更新当前 State。

测量：Large-document Typing、Preview Latency、Mount Time、Dialog / Toolbar Interaction、Repeated Open / Close Memory、Listener Count 和 Production Bundle。

## 二十、构建与依赖

使用根 npm 项目中的 Vite。源码在 `frontend/`，编译 Runtime 在 `assets/build/`。

首个实际 Build Task 必须选择并验证一个一致的加载方案：

### 方案 A：Classic WordPress Script

- 使用 `wp_enqueue_script()`；
- Entry 使用与经典脚本兼容的输出；
- `react`、`react-dom`、`@wordpress/element` 和选择的 JSX Runtime 正确 Externalize / Map；
- Asset Metadata 声明实际 WordPress Dependency；
- 若输出格式不支持 Code Splitting，不宣称拥有 Rollup Dynamic Chunk；
- Optional Runtime 通过明确 Local Asset Loader 按需加载。

### 方案 B：WordPress Script Modules / ESM

- 只有在最低支持版本的稳定 API 和实际依赖图验证后使用；
- 明确 Module Registration、Import Specifier 和 Dependency；
- 不重复 Bundle React Runtime；
- 验证 Dynamic Import、CSS、Chunk URL、Subdirectory、Multisite 和非默认 Plugin URL。

无论方案：

- WordPress 提供 React Runtime；
- Manifest 和 Dependency Metadata 是构建事实；
- Primary Script Handle 保持稳定；
- Content-hashed Chunk 只有在 Manifest Loader 支持时使用；
- Dynamic Asset URL 从 Plugin Asset Base 解析；
- 不硬编码 `/wp-content/plugins/easymde/`；
- Runtime Asset 全部本地；
- Production 不引用 Vite Dev Server、Localhost、Temporary Path 或 Remote CDN；
- Release 检查每个 Entry 和 Chunk，包含 Private React Implementation 时失败；
- External Reference 与 WordPress Dependency 必须一致。

Dependency 只有在当前任务有明确责任时才增加。增加前确认 Existing Capability、Direct / Transitive Size、Maintenance、License、Remote Asset、Telemetry、Testing、Removal、Lockfile 和 Third-party Notices。

不得因为文章或通用 Skill 推荐就默认引入 Zustand、Redux、React Query、SWR、React Hook Form、Zod、Router、Animation、Icon 或 Utility Library。

## 二十一、测试、发布与维护

按责任测试：

- `domain`：Pure Rule 和 Edge Case；
- `contracts`：Schema Version、PHP / TypeScript Fixture、Error Mapping 和 Safe Value；
- `integrations`：WordPress DOM、Native Form、Nonce、Lock、REST、Media、Storage、Clipboard、Mount 和 Failure；
- `features`：Component 和 Hook 使用 Mock Runtime；
- `app`：Provider、Independent Store、Error Boundary、Activation 和 Composition；
- E2E：安装 Release ZIP 后的真实 WordPress Flow；
- Release Test：编译 Entry 存在，Development File 不存在。

前端工具链存在后自动检查：

- TypeScript Strict 和 `noEmit`；
- Hook、A11y 和 Dependency Boundary；
- Restricted Global；
- Component 不导入 WordPress Adapter；
- React Runtime Import；
- Manifest、Dependency Metadata、CSS 和 Chunk；
- PHP / TypeScript Contract Parity；
- Installable ZIP Boundary。

安装版 ZIP 排除：

```text
.agents/
frontend/
docs/ 中的开发架构资料
node_modules/
tests/
coverage/
Playwright output
TypeScript 和 React 源码
Source Map，除非明确批准
Vite Cache
Local Log 和配置
Development Server Metadata
无关开发文件
```

维护规则：

- 优先清晰的局部实现，不为未来猜测提前抽象；
- 重复职责稳定后再抽取 Shared Code；
- Public Contract 小而 Versioned，Concrete Implementation 保持 Private；
- Public Extension 删除前先 Deprecate，并提供兼容和测试方案；
- 重大架构决定记录约束、选择理由、替代方案和回退条件；
- 长期决策变化时同步更新本文与 EasyMDE Skill；
- 删除已经过时的规则，不因历史存在而永久保留；
- 不声称未实际执行的 Test、Review、Performance、A11y 或 Browser Validation。

## 二十二、功能逐项接管

本文不规定 Feature 顺序。每个功能由自己的聚焦 Issue 决定 Scope、Dependency、Acceptance 和 Ownership Handoff。

原生 JavaScript 与 React 共存期间，每个行为只有一个 Active Owner：

```text
确认现有 Native Contract
→ 验证 Bootstrap 和 Capability
→ 创建 Runtime 和 Store
→ Mount React Root
→ 确认 React Ready
→ 激活 React Ownership
→ Detach 旧 Owner
```

规则：

- React Ready 前不隐藏旧 Owner；
- Startup Failure 保留可用 Owner；
- 同一行为不注册两套 State-changing Listener；
- 不同时运行两个 Preview Scheduler、Draft Timer、Shortcut Manager、Save Observer、Publish Handler、Media Handler 或 Clipboard Exporter；
- DOM Presence 不是唯一 Ownership Truth；
- 行为、Failure、A11y、Browser 和 Release 验证完成后才能删除旧 Owner；
- 不机械地让一份旧 JS 对应一份新 TS；
- 删除旧实现必须由对应 Issue 明确授权。

## 二十三、禁止事项

禁止：

1. Gutenberg Editor 替代、Next.js、Webpack、其他 Frontend Framework 或替代 Publishing Backend。
2. React 19-only API、Private React Runtime、Hydration、RSC 或 Server Action。
3. Browser Formal Markdown Renderer 或 CSS Security Parser。
4. 第二套 Canonical Document、Save、Publish、Revision、Media、Settings、Timezone 或 Public-content Authority。
5. Component 直接访问 WordPress DOM、jQuery、`wp.apiFetch`、`wp.media`、Storage、Clipboard 或 Global Bootstrap。
6. Universal Adapter、Generic `execute(type, payload)`、God Component、Shared Mutable Root Store 或 Stringly Typed Event Bus。
7. Circular Dependency、Upward Import、Broad Barrel、Feature-private Deep Import 或 Speculative Abstraction。
8. Render-time Side Effect、Effect-driven User Command、Mirrored State、Duplicated Authority 或 Impossible Boolean State。
9. Random Key、Reorderable Domain Data 的 Index Key、Nested Component Definition 导致的 Accidental Reset。
10. Silent Fallback、Swallowed Error、Fake Success、Hidden Write、Force Click Disabled Control 或 Mutation Auto Retry。
11. Stale Async Work 更新当前 Post、Root、Dialog 或 Session。
12. 无 Cleanup、Idempotence 和 Failure Handling 的 Effect。
13. Browser-local Scheduling 覆盖 WordPress Site Timezone。
14. 忽略 Extension Registry、只支持 Built-in Command 的实现。
15. Root-relative Plugin Asset URL、Remote Runtime CDN、Production Dev Server 或未批准 Telemetry。
16. Empty Feature Directory、Placeholder Module、Unused Asset 或无 Owner Dependency。
17. Private Article、Custom CSS、Prompt、Token、Nonce、Credential 或 Secret Endpoint 写入 Diagnostics。
18. Source、Test、Cache、Log、`.agents/` 或 Development Metadata 进入安装 ZIP。
19. 二手文章或通用 Skill 被当成高于 EasyMDE 项目证据的规则。

## 二十四、完成证据

一个 React / TypeScript Feature 只有在相关项目全部满足后才能报告完成：

1. 每个 State 和 Behavior 有单一 Owner。
2. Component Hierarchy 来自 Data Model 和用户可识别职责。
3. Render 和 Hook 保持 Pure。
4. State 最小、无重复，并按 Identity 有意 Reset。
5. Directory Placement 和 Dependency Direction 正确。
6. Props、Event、Ref、Hook API、Naming 和 Public Export 符合 TypeScript 规范。
7. External Value 有 Runtime Validation。
8. Component 只使用 Focused Port，不直接访问 WordPress / Browser Global。
9. PHP / WordPress Capability、Nonce、Validation、Sanitization、Escaping、Save、Publish、Lock 和 Data Authority 保持完整。
10. Native Field、Real Save / Publish Observation、Cancellation、Stale Rejection 和 Teardown 有测试。
11. A11y、Focus、Keyboard、IME、Selection、Undo、Scroll、RTL、Zoom 和相关视觉状态有证据。
12. Performance 结论有 Measurement。
13. Build Metadata、Runtime Externalization、Asset URL、Local Asset 和 Package Exclusion 已验证。
14. Exact Diff、Test、CI、Review Finding、Unverified Area 和 Remaining Risk 被诚实记录。
