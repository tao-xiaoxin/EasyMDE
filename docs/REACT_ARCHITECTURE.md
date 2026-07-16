# EasyMDE React 架构规范

本文定义 EasyMDE WordPress 后台 React、TypeScript 与 Vite 应用的长期架构合同。

它记录稳定的目录边界、所有权、数据流、运行时、构建、测试和发布决策。具体开发步骤、检查清单和 Feature 实施细节由 `.agents/skills/easymde/SKILL.md` 与对应 GitHub Issue 补充。

本文不是当前实现清单，也不规定功能开发顺序。当前代码事实始终以实时仓库和 `docs/ARCHITECTURE.md` 为准。任何目录、配置、接口或依赖都只能在实际功能需要时创建，不得根据本文一次性生成空目录或占位文件。

## 一、规则优先级

React 相关任务按以下优先级执行：

1. 当前明确任务、关联 GitHub Issue 和人工维护者决定。
2. 根目录 `AGENTS.md` 以及实时仓库中的数据、安全、兼容、扩展、隐私、测试和发布合同。
3. 本文与 `.agents/skills/easymde/SKILL.md` 共同组成 EasyMDE 项目级 React 规则：本文负责稳定架构，Skill 负责实施细节。
4. 通用 React、组件组合和 Web 设计 Skill。

通用 Skill 可以补充质量实践，但不得覆盖 EasyMDE 项目规则，不得引入 Next.js、React Server Components、Server Actions、Webpack、Gutenberg 替代方案、私有 React Runtime、替代保存发布后端或未经验证的新依赖。

若本文、EasyMDE Skill 与实时仓库出现冲突，不要静默选择其中一个。应先确认真实项目合同，并在同一任务中同步修正文档。

## 二、产品与所有权边界

React 应用覆盖 WordPress 后台中明确属于 EasyMDE 的交互界面，例如：

- 编辑器工作区；
- 标题和 Markdown 编辑界面；
- 实时预览和大纲；
- 工具栏和 Markdown 操作；
- 布局、主题、字体和自定义 CSS；
- 发布界面；
- 历史版本；
- 媒体选择、图片上传和粘贴；
- 本地草稿恢复；
- 微信富文本复制；
- 设置页；
- 后续明确批准的 AI 助手界面。

React 负责：

- 界面渲染；
- 用户交互；
- 组件组合；
- 对话框、面板和布局；
- 当前浏览器会话中的临时状态；
- 对外部能力的调用编排；
- 加载、空、错误、权限不足和冲突状态的呈现。

PHP 和 WordPress 继续负责：

- 插件加载、Hook 和服务装配；
- 支持的 Post Type 准入；
- 权限与 Nonce；
- Post Meta 和 Options API；
- Markdown 正式渲染和 HTML 安全过滤；
- Custom CSS 安全策略；
- 修订版本；
- 媒体库和上传权限；
- 分类、标签和特色图片；
- 原生保存、发布、状态和计划发布时间；
- Autosave、Heartbeat 和文章锁；
- 前台文章、Feed、搜索、邮件和 REST 消费者需要的兼容 HTML；
- 文章主题和代码主题注册表。

总体数据流：

```text
PHP / WordPress
拥有持久化数据、安全、渲染、保存和发布
                 ↓
Versioned Bootstrap Contracts + Focused Ports
                 ↓
React Applications
拥有后台界面、交互和浏览器会话状态
```

React 不得创建第二套正式 Markdown Renderer、数据权限系统、文章保存路径、发布后端、修订模型、媒体存储、设置存储、站点时区模型或前台内容权威。

## 三、运行时基线

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
- 使用 `createRoot`，不添加旧版 `render` 兼容分支；
- 每个 Root 都保存并执行 `root.unmount()`；
- 构建产物声明正确的 WordPress Runtime 依赖；
- 安装包不重复打包 React 或 ReactDOM；
- 不混用 WordPress React 与插件私有 React；
- 不在两个 React Runtime 之间传递 Element、Context、Hook、Portal 或 Ref；
- 不使用 React 19 专属 API；
- 不使用 Hydration，后台 Root 是客户端挂载应用；
- 不为 WordPress 6.7 以下版本增加兼容代码或测试路径。

`forwardRef()` 和 `useContext()` 在 React 18 中仍然有效，但只能在真实组件合同需要时使用。

`@wordpress/components` 不作为 EasyMDE 的第二套默认设计系统。某个功能确实需要 WordPress 原生组件时，必须验证 WordPress 6.7 API、稳定性、视觉合同、无障碍、依赖和 Bundle 行为，并隔离在明确的 UI 或 Integration 边界中。

## 四、仓库根目录

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

原因：

- 版本、依赖和发布流程属于同一个插件；
- 两个 Lockfile 会制造依赖和 CI 漂移；
- Vendor 资源准备、前端构建和安装包生成必须处于同一可复现依赖图；
- 根 `package.json` 继续参与版本、i18n、第三方声明和发布校验。

## 五、React 源码目录

默认目录结构：

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

这是一份目录边界，不是要求一次性创建全部路径。

不得创建空目录、空 `index.ts`、占位组件、未来 AI 文件或没有当前责任的抽象层。

不要在应用根目录创建通用的：

```text
components/
services/
helpers/
utils/
```

这些目录会隐藏真实所有权。

## 六、应用 Root 与 Entrypoint

每个真实 WordPress 页面或独立加载的应用面拥有自己的 Entrypoint、Runtime、Store、Provider、Error Boundary 和生命周期。

```text
entrypoints/admin-editor.tsx
→ app/editor/*

entrypoints/settings.tsx
→ app/settings/*
```

禁止把两者放入共享的：

```text
app/store/
app/providers/
```

Entrypoint 只负责：

- 定位并验证 Root；
- 读取并验证对应 Bootstrap Contract；
- 创建 Runtime；
- 创建当前 Root 的 Store；
- 挂载 React；
- 等待应用进入 Ready 状态；
- 激活该 Root 的所有权；
- 记录启动失败；
- 完整卸载和清理。

Entrypoint 不包含 Feature 业务逻辑、REST 实现、WordPress DOM Selector、主题和发布规则、对话框状态或大段组件 JSX。

启动失败时必须保留此前可用的界面所有者，或显示明确的致命错误。禁止在 Bootstrap 验证和 React Ready 之前隐藏现有界面。

多个 Root 出现在同一页面时，每个 Root 必须拥有独立 Store、Provider 和 Teardown，并证明 Context 与可变状态没有交叉。

## 七、分层职责

### `app/`

负责某个 Root 的 App Shell、Provider、Error Boundary、Store 创建、顶层布局、Runtime 注入和生命周期。

`app/editor/` 与 `app/settings/` 不共享可变 Store、Query Cache、Error Boundary 状态或生命周期所有者。

### `contracts/`

定义 PHP、WordPress、浏览器和 React 之间稳定、可验证的接口：

- Bootstrap Schema；
- Runtime Ports；
- REST Request / Response；
- Operation Result；
- Error Code；
- Safe HTML 品牌类型；
- 扩展命令和 Shortcode Helper；
- Browser Storage Payload；
- Build Manifest 和 Asset Metadata。

TypeScript Interface 不能代替运行时验证。所有外部数据必须在边界解析。

### `domain/`

只包含纯业务规则，不允许依赖 React、JSX、DOM、WordPress Package、Browser Global、Network、Feature UI 或 Concrete Adapter。

适合放在 Domain 的能力包括：

- 标题和换行标准化；
- Dirty State；
- Markdown Selection 和命令；
- Outline；
- Statistics；
- Table Markdown；
- Publishing Draft 和 Category Tree；
- Appearance State；
- Revision 对比规则；
- 纯设置校验模型。

### `features/`

按用户能够理解的能力组织：

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

仅在实际功能包含代码时创建目录。

大型 Feature 可以采用：

```text
features/publishing/
├── ui/
├── model/
├── styles/
├── publishing.types.ts
└── index.ts
```

规则：

- `ui/` 负责渲染和直接交互；
- `model/` 负责 Feature 状态和 Port 调用编排；
- 可脱离 React 复用的规则放入 `domain/`；
- WordPress、REST、Storage、Clipboard、Media 和 DOM 实现放入 `integrations/`；
- `index.ts` 只使用明确命名导出；
- 禁止 `export *`；
- 其他 Feature 不得深层导入私有文件；
- Feature 内部不得通过自己的 `index.ts` 反向导入；
- 只有真实跨 Feature 且无业务所有权的代码才能进入 `shared/`。

### `integrations/`

集中 WordPress、REST、Browser、Storage、Clipboard、Media、Preview Enhancement 和 Diagnostics 访问。

WordPress 子目录必须对应明确 Port，不得建立通用 `editor/`、`api/`、`WordPressService` 或超大 `EditorAdapter`。

### `shared/`

只包含无 EasyMDE Feature 所有权、无 WordPress 业务决策的通用 UI、Hook、Icon、Pure Utility 和 Type。

## 八、依赖方向

```text
entrypoints  → app, contracts, integrations
app          → features, contracts, shared
features     → domain, contracts, shared
domain       → shared 中的纯函数和类型
contracts    → domain 类型和 shared 类型
integrations → contracts, domain, shared
shared       → 不依赖 app、Feature、Integration 或 WordPress
```

规则：

- `domain/` 不导入 React、WordPress 或浏览器 API；
- `contracts/` 不依赖 Concrete Adapter；
- `integrations/` 不导入 Feature UI 或 App Shell；
- `shared/` 不得伪装成第二个应用层；
- 不得向上导入 `app/` 或 `entrypoints/`；
- Circular Import 是缺陷；
- Feature 只能通过公开 API 协作；
- Entrypoint 负责依赖注入，Feature 不创建 WordPress Adapter；
- 前端工具链存在后，使用 ESLint Restricted Imports 或等效规则自动检查。

## 九、代码风格与命名

```text
目录                    kebab-case
React Component         PascalCase.tsx
Error Boundary           PascalCase.tsx
Hook                     useFeatureName.ts
纯函数模块               camelCase.ts
WordPress Adapter        PascalCase.ts
Port 文件                feature-port.ts
类型模块                 feature.types.ts
CSS                      kebab-case.css
测试                     source-name.test.ts 或 SourceName.test.tsx
```

TypeScript 规则：

- 启用 Strict Mode；
- 外部边界使用 `unknown` 和运行时 Schema；
- 禁止用 `any` 代替验证；
- Async State、Operation Result 和互斥 Variant 使用 Discriminated Union；
- 类型导入使用 `import type`；
- Closed Union 使用 Exhaustive Switch 和 `assertNever()`；
- 避免 Non-null Assertion；
- 不使用翻译文本、DOM Selector、Label 或 CSS Class 作为业务 ID；
- 不跨层使用深层相对路径；
- Source Alias 只有在工具链定义后才能使用；
- 不假设浏览器支持未经 Vite Target 验证的新 API；
- 不通过禁用 Type、Lint、A11y 或 Dependency Rule 掩盖问题。

格式化规则由项目实际引入的 Formatter 配置统一决定。本文不预设 Prettier 或其他工具。

## 十、Bootstrap 与 Schema

每个 Root 拥有独立、带版本的 Bootstrap Contract。

代表性编辑器 Bootstrap：

```ts
export interface EditorBootstrap {
  version: 1;
  post: PostBootstrap;
  site: SiteBootstrap;
  document: DocumentSnapshot;
  appearance: AppearanceSnapshot;
  capabilities: EditorCapabilities;
  endpoints: EditorEndpoints;
  limits: EditorLimits;
  assets: EditorAssets;
  storage: EditorStorageKeys;
  publishing: PublishingBootstrap;
  settings: EditorSettingsSnapshot;
  strings: EditorStrings;
  commands: CommandDefinition[];
  shortcodeHelpers: ShortcodeHelperDefinition[];
}
```

规则：

- 挂载前验证所有 Required Field；
- 缺少 Endpoint、Capability、Translation、Limit、Asset、Document 或 Security Source 时启动失败；
- 禁止用 `{}` 或虚构默认值静默兜底；
- Unknown Optional Field 可以忽略；
- Unknown Contract Version 必须明确失败；
- 语义不兼容时递增 Version；
- PHP 内部使用 `snake_case`，Browser Contract 在序列化边界转成 `camelCase`；
- 组件不直接读取 Global Bootstrap；
- 新文章获得真实 Post ID 时，必须重新绑定 Storage Key、Query Key、Lock 和 Request Ownership；
- 使用 PHP Fixture 与 TypeScript Schema 做跨语言合同测试；
- Bootstrap 不得包含 Credential、Cookie、私密配置或当前页面不需要的数据。

## 十一、Runtime Ports

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

代表性接口：

```ts
export interface DocumentPort {
  readNativeSnapshot(): NativeDocumentSnapshot;
  synchronizeSubmissionBridge(
    snapshot: DocumentSubmissionSnapshot,
  ): void;
  applyEditorTransaction(
    transaction: DocumentTransaction,
  ): DocumentTransactionResult;
}

export interface SavePort {
  request(kind: 'draft' | 'update'): Promise<SaveResult>;
  subscribe(listener: (event: SaveEvent) => void): () => void;
}

export interface SessionPort {
  getPostIdentity(): PostIdentity;
  getCurrentRestNonce(): string;
  getLockState(): PostLockState;
  subscribe(listener: (event: SessionEvent) => void): () => void;
}

export interface PreviewPort {
  render(
    request: PreviewRequest,
    options: {
      signal: AbortSignal;
      requestId: number;
    },
  ): Promise<PreviewResult>;
}
```

规则：

- `DocumentPort` 负责编辑事务和原生提交桥，不直接持久化 Post Meta；
- `SavePort` 触发并观察 WordPress 现有保存流程，不调用替代保存 Endpoint；
- `SessionPort` 负责 Post Identity、Capability、Lock 和当前 Security Token；
- `PublishingPort` 负责发布字段和原生发布确认；
- 每个 Subscription 返回可重复调用的 Unsubscribe；
- Cancellation、Conflict、Validation 和 Success 使用明确 Result；
- 新外部职责需要独立 Port，禁止扩张万能 Adapter；
- AI 使用 `AiPort`，不得塞入 `DocumentPort`。

只有 Entrypoint 和对应 Integration 可以知道：

```text
window.EasyMDEConfig
window.wp
wp.apiFetch
jQuery
WordPress 字段 Selector
原生保存和发布按钮 Selector
wp.media
localStorage
sessionStorage
navigator.clipboard
document.execCommand
```

React Component、Domain、Feature Model 和 Shared UI 禁止直接访问这些对象。

## 十二、持久化数据与文章准入

受保护的 Post Meta：

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

- `_easymde_markdown` 是唯一权威 Markdown；
- `post_content` 是 PHP 生成并清洗的 WordPress 兼容 HTML；
- `_easymde_enabled` 描述已保存的 EasyMDE 文档状态，不决定支持文章是否进入编辑器；
- `easymde_supported_post_types` 和 `PostModeController` 决定准入；
- 普通支持文章首次打开时，通过现有 PHP 兼容路径在内存中获得 Markdown；
- 首次打开不得写 Meta、重写 `post_content`、创建 Revision 或标记 Enabled；
- 空字符串 Markdown 是合法状态，检测必须保留 `metadata_exists()` 语义；
- 下一次合法保存才写入 EasyMDE Meta；
- `_easymde_render_signature` 只是兼容 HTML 一致性标记；
- Revision Restore 必须恢复 Markdown 和 Appearance，并由 PHP 重新生成兼容 HTML；
- `_easymde_code_mac_style` 和历史 `codeMacStyle` 仅作为历史数据保留；
- 未经明确数据兼容方案和测试，不得重命名、删除、重新解释或提前初始化任何 `_easymde_*` 字段。

## 十三、原生表单、保存、锁和 Nonce

WordPress 原生表单仍是文章提交合同。

```text
PHP 初始状态
→ 验证 Bootstrap
→ 当前 Root Store
→ 用户事务
→ 同步更新原生提交桥
→ WordPress 原生保存或发布
→ PHP 保存 Markdown 和兼容 HTML
→ Adapter 观察真实成功
→ Store 更新 Saved Baseline
```

规则：

- 接受 React 编辑事务后，同步更新原生字段；
- 不给提交桥留下 Debounce 空窗；
- React 不生成或验证 PHP Save Nonce；
- Autosave 不自动等于 Canonical EasyMDE Save；
- React Dirty State 与 WordPress Unload / Form Dirty State 使用同一 Saved Baseline；
- 保存和发布必须观察真实 WordPress 结果；
- Disabled、Missing、Replaced 或扩展修改过的原生控件属于 Preflight Failure；
- 禁止强制点击 Disabled 控件；
- REST Nonce 不能在启动时读取一次后永久缓存；
- Heartbeat 刷新安全状态后，Session Adapter 必须读取新 Token；
- Invalid Nonce 进入明确 Reauthentication 状态，不自动重试写操作；
- 丢失文章锁或权限时，停止写操作、取消 Pending Mutation、保留未保存内容并解释原因；
- 计划发布时间使用 WordPress 站点时区和原生字段。

## 十四、状态与 React 18 行为

每个应用 Root 拥有自己的 Store。设置页不共享 Editor Store。

不强制指定 Zustand、Redux、React Query、SWR 或其他库。只有在具体任务证明需要、职责明确且发布成本可接受时才可以引入。

规则：

- 临时输入、Hover、未确认 Dialog Field、局部 Validation 和 Drag State 留在最近组件；
- 多个 Feature 共享的编辑会话状态进入 Editor Store；
- REST Collection 由单一 Server-State Owner 管理并显式 Invalidate；
- Derived Value 通过 Selector 或纯函数计算；
- 不通过 `useEffect` 镜像两份 React State；
- 真实保存成功后才更新 Saved Baseline；
- Browser Storage 只保存明确批准、带版本和恢复规则的数据；
- Post Identity 变化时清理或重新绑定状态；
- Stale Query 或 Stream 不得更新另一个 Post、Root、Dialog 或 User Session。

React 18 性能规则：

- Markdown 输入立即更新浏览器会话状态；
- Debounce Preview 和昂贵派生工作，不 Debounce 用户文本和原生提交桥；
- 使用最小 Selector 订阅；
- 不为 Outline、Statistics、Dirty、Syntax 和 AI Context 分别重复解析整篇文档；
- 不默认添加 `memo`、`useMemo` 和 `useCallback`；
- 优化前先测量；
- `startTransition()` 不包裹编辑器值、提交桥、保存发布、焦点和无障碍关键状态；
- Suspense 不作为隐式 WordPress 数据层；
- `React.lazy()` 只用于可选重型 UI，并提供可访问 Fallback；
- 独立 Read 可以并发，Dependent Read 和 Mutation 保持正确顺序。

## 十五、生命周期与 DOM 所有权

React 只拥有自己声明的 Root 和自己创建的 Portal。

规则：

- Component 不查询 WordPress DOM；
- Adapter 可以读取或同步文档化的原生字段；
- 不为了布局方便移动、复制或删除 WordPress 控件；
- Portal 必须有单一所有者、清理、Focus Return 和 Stacking Context 分析；
- Body Class、Inline Style、CSS Variable、Scroll Lock、Global Cursor 和 Pointer Capture 必须有单一生命周期所有者；
- 不使用 DOM Mutation 作为 Event Bus；
- MutationObserver 必须范围明确且可卸载；
- 每个 Effect 都必须有 Owner、Trigger、Cleanup 和 Failure Path；
- Cleanup 可以重复调用，也可以在部分初始化失败后调用；
- Strict Mode 和重复挂载不得重复写入、Mutation、Upload、Clipboard、Timer 或 Subscription；
- 用户操作优先放在 Event Handler 或 Command，不通过 Effect 观察 State 后触发 Mutation。

## 十六、预览和安全 HTML

PHP `EasyMDE\Content\MarkdownRenderer` 是唯一正式 Markdown Renderer。

准确的预览响应所有权：

```text
Markdown
→ PreviewPort
→ POST easymde/v1/preview
→ PreviewController 验证请求和权限
→ MarkdownRenderer 只生成并清洗 HTML
→ MarkdownFeatureDetector 检测 Mermaid / KaTeX / Highlight 等特征
→ PreviewController 返回 { html, features }
→ React Preview Surface
→ Preview Runtime 执行对应 Progressive Enhancement
```

`features` 由 `PreviewController` 结合 `MarkdownFeatureDetector` 组装，不是 `MarkdownRenderer` 的返回职责。

禁止在浏览器中引入另一套正式 Markdown Renderer 或在服务器失败时显示近似 HTML。

Preview Request 必须支持 Abort、Request ID 或 Document Revision，并拒绝 Stale Response。Enhancement Failure 不得破坏 Sanitized HTML。

只有经过正式 Preview Contract 验证的 Server HTML 可以进入受控 `dangerouslySetInnerHTML` Sink。Markdown、AI Output、Error Response、Custom CSS、LocalStorage 和普通字符串不能直接进入该 Sink。

## 十七、关键功能边界

### 发布

React 维护 Publish Draft，但 WordPress 保持最终权威：

```text
React Publish Draft
→ PublishingPort.preflight()
→ 同步原生发布字段
→ WordPress 原生发布
→ Adapter 观察真实结果
```

取消必须零写入。成功只以真实 WordPress 结果为准。

### 修订版本

Revision Restore 恢复 Markdown 和 Appearance，随后由 PHP 生成兼容 HTML。React 不创建第二套 Revision Store。

### 媒体

媒体库和上传通过 `MediaPort`。Cancellation 零写入；上传成功且 Document Transaction 仍有效后才插入 Markdown；恢复 Selection 和 Focus；清理 Object URL；失败不留下 Placeholder 或 Fake Attachment。

### 主题与自定义 CSS

主题选项来自 PHP Registry：

```text
easymde_article_themes
easymde_code_themes
```

Custom CSS 的权限、解析、Selector Scope、Blocked Token、Remote Loading、Size Limit 和 Nested At-rule 继续由 `CustomCssPolicy` 和现有 REST Endpoint 管理。浏览器不得实现另一个 CSS Parser 作为安全边界。

### 设置页

设置页是独立 Root。`manage_options`、Options API、`register_setting()` 和 PHP Sanitizer 保持权威。保存成功只以 WordPress 接受并持久化 Sanitized Option 为准。

### 本地草稿

Local Draft 是内容恢复，不是 WordPress Save。Key 包含 Site、User 和 Post Identity；Payload 带 Version；不保存 Nonce、Credential、Password 或 Provider Token；不静默覆盖 Server Document。

### 微信复制

只允许从当前成功、稳定、已清洗的 Preview 复制。Clipboard 拒绝是真实失败；Legacy Path 必须恢复 Selection、Range、Focus、Scroll 和临时 DOM。

### AI 助手

AI 只在明确任务中创建。Credential 和 Private Endpoint 留在 Server；Context Scope 可见且最小；Stream 可取消；AI 修改是可预览、可拒绝、可撤销的 Document Transaction；AI 不自动保存、发布、上传、修改设置或主题。

## 十八、无障碍与样式边界

无障碍是组件合同的一部分：

- Action 使用 `<button>`，Navigation 使用 `<a>`；
- 优先使用 Native Form Control；
- 每个 Interactive Control 有 Accessible Name；
- Icon-only Button 使用显式 Label；
- 保留 Visible Focus；
- Color 不是唯一状态信号；
- Label、Help、Error 和 Invalid State 正确关联；
- Pending 时只阻止重复写操作；
- Dialog 有 Label、Focus Containment、Escape 和 Focus Return；
- Destructive、Publishing、Unsaved 或 In-progress Dialog 默认不允许误触 Backdrop Close；
- Toolbar Command 保留 Selection 并恢复 Focus；
- IME Composition 期间不触发冲突 Shortcut；
- Split Pane 支持 Pointer 和 Keyboard，并在取消时释放 Pointer Capture。

样式限定在稳定 EasyMDE Root 下：

- 不覆盖 WordPress Admin 全局元素；
- 避免 Broad `!important` 和 Arbitrary Offset；
- Design Token 与 Article Theme 和前台 CSS 分离；
- 使用 Logical Property 支持 RTL；
- 使用受控 Z-index Scale；
- 使用项目批准的本地图标来源；
- CSS Modules 仅在实际受益时使用；
- Protected Selector 和 Observable Behavior 只有在明确任务中才能改变。

## 十九、构建架构

源码放在 `frontend/`，编译运行时放在 `assets/build/`。

Primary WordPress Handle 保持稳定；Chunk 可以使用 Content Hash，并由 Manifest 解析。PHP 禁止猜测 Hashed Filename。

### 构建输出模式决策门槛

本文不提前决定经典脚本单包或 WordPress Script Modules。

首个实际构建任务必须明确选择并验证其中一种方案。

#### 方案 A：经典脚本

- 使用 `wp_enqueue_script()`；
- Entry 使用与经典脚本兼容的单包格式；
- Vite / Rollup 必须将 `react`、`react-dom` 和 `@wordpress/element` 外部化；
- 对应全局映射分别验证为 `React`、`ReactDOM` 和 `wp.element`；
- Asset Metadata 声明 `wp-element` 以及实际使用的其他 WordPress Script Handle；
- 若使用 Automatic JSX Runtime，必须外部化 `react/jsx-runtime` 并声明实际 WordPress Handle，或配置为不产生该导入；
- 若所选输出格式不支持 Rollup Code Splitting，不得同时宣称拥有 Dynamic Chunk；
- Optional Runtime 可以通过明确的本地 Asset Loader 按需加载。

#### 方案 B：Script Modules / ESM

- 使用 WordPress 6.7 支持的 Script Modules API；
- 明确注册 Module Dependency 和 Import Map；
- `react`、`react-dom`、`@wordpress/element` 和 JSX Runtime 不得被 Bundle 重复实现；
- 验证每个 Import Specifier 实际映射到 WordPress 提供的 Runtime；
- 验证 Dynamic Import、CSS 和 Chunk URL；
- 验证插件子目录、Multisite 和非默认 Plugin URL。

禁止同时写出“IIFE Entry”和“Rollup Dynamic Chunk”却不提供可运行的加载合同。

无论选择哪种方案，都必须：

- 使用 WordPress 提供的 React Runtime；
- 生成可验证的 Manifest 和 Dependency Metadata；
- 保持运行时资源本地化；
- 不引用 Vite Dev Server、Localhost、临时路径或远程 CDN；
- Dynamic Asset URL 从插件 Asset Base 解析；
- 不硬编码 `/wp-content/plugins/easymde/`；
- 验证 WordPress 子目录安装；
- 保持 Script Handle、Translation、Version 和 Load Order；
- 检查 Clean Checkout 是否可根据 Lockfile 构建；
- 检查所有 Entry 和 Chunk，若包含 React、ReactDOM、`@wordpress/element` 或 JSX Runtime 的实现代码，发布构建必须失败；
- 同时确认外部引用与 WordPress Script / Module Dependency 一致，避免 Runtime 未入队。

根 `package.json` 只在相应工具真实存在后添加脚本。不得添加 Placeholder Command。

## 二十、依赖策略

依赖只有在当前任务有明确责任时才可以增加。

不得因为通用 Skill 推荐就默认引入 Zustand、Redux、React Query、SWR、React Hook Form、Zod、Router、Animation Library、Icon Library 或 Utility Library。

增加前必须确认 Feature、Boundary、现有能力、Package Size、Transitive Dependency、Maintenance、License、Remote Asset、Telemetry、测试、移除方式、Lockfile 和 Third-party Notices。

不得为同一责任使用两套库。

## 二十一、测试和架构校验

按责任选择测试：

- `domain`：纯函数和边界值；
- `contracts`：Schema Version、PHP / TypeScript Fixture、Error Mapping 和 Safe Value；
- `integrations`：WordPress DOM、Native Form、Nonce、Lock、REST、Mount、Storage、Clipboard、Media 和 Failure；
- `features`：组件和 Hook 使用 Mock Runtime；
- `app`：Provider、独立 Store、Error Boundary、Activation 和 Composition；
- `tests/e2e`：安装 Release ZIP 后的真实 WordPress 流程；
- Release Test：编译 Entry 存在，开发文件不存在。

前端工具链存在后自动检查 TypeScript Strict、Dependency Direction、Restricted Global、React Runtime Import、Manifest、PHP / TypeScript Contract、REST Fixture 和安装包边界。

至少覆盖相关场景：

- WordPress 6.7 和 Latest；
- `createRoot` Mount 和 Teardown；
- Strict Mode 和重复挂载；
- Editor 与 Settings 独立 Root；
- Permission、Authentication Expiry、Nonce Refresh 和 Lock Loss；
- Save / Autosave 的 Native Field 同步；
- 普通支持文章零写入打开；
- Empty Markdown 和首次合法保存；
- Preview Limit、Renderer Missing、Stale Response 和 Enhancement Failure；
- Media、Storage、Custom CSS、Settings 和 Clipboard Failure；
- Focus、Selection、IME、Undo、Scroll、Drag Cancellation、RTL 和 Long Translation；
- Large Document、Subdirectory Install 和 Asset Loading；
- Release Completeness 和 Privacy-safe Artifact。

组件测试使用 Semantic Role 和 Accessible Name，测试用户行为，不测试 Hook 数量和私有 State。

不得声称执行了未实际完成的校验。

## 二十二、公开前台边界

后台采用 React 不改变公开文章架构。

公开文章继续使用 PHP 生成并清洗的 `post_content`：

- 不在公开内容中挂载或 Hydrate 后台 React 应用；
- Visitor Page 不加载 Editor、Settings、Media、Publishing、Revision 或 AI Bundle；
- Feed、Search、Email、REST Consumer 和禁用 JavaScript 的浏览器仍获得可用 HTML；
- Mermaid、KaTeX 和 Highlight.js 仍然是按需 Progressive Enhancement；
- SEO 和文章主体不能依赖 React 加载成功。

## 二十三、发布包

安装版插件 ZIP 可以包含 PHP 生产代码、Template、Composer Runtime Dependency、Translation、Local Vendor Asset、必需的编译 JavaScript / CSS、License 和 Third-party Notices。

必须排除：

```text
.agents/
frontend/
docs/ 中的开发架构资料
node_modules/
tests/
coverage/
Playwright output
TypeScript 和 React 源码
Source Map，除非发布策略明确要求
Vite Cache
Local Log 和配置
Development Server Metadata
无关开发文件
```

发布前必须实际检查 ZIP，并验证 Runtime Asset、Manifest、WordPress Dependency Metadata、License、Notices、无重复 React、无 Localhost / Dev Client / Source Path / Remote CDN，以及 Public Page 不 Enqueue Admin React Entry。

## 二十四、功能接管与旧实现交接

本文不规定功能开发顺序。每个功能由自己的聚焦 Issue 决定范围、依赖、验收和交接时间。

在原生 JavaScript 与 React 同时存在期间，每个行为只能有一个 Active Owner。

```text
确认现有原生合同
→ 验证 Bootstrap 和 Capability
→ 创建 Runtime 和 Store
→ Mount React Root
→ 确认 React Ready
→ 激活 React Ownership
→ 再关闭或 Detach 该功能的旧 Owner
```

规则：

- React Ready 前不得隐藏旧 Owner；
- 启动失败时保留可用 Owner；
- 同一行为不能同时注册两套 State-changing Listener；
- 不能同时运行两个 Preview Scheduler、Draft Timer、Shortcut Manager、Save Observer、Publish Handler、Media Handler 或 Clipboard Exporter；
- 不以 DOM 是否存在作为唯一所有权事实；
- 只有行为、Failure、Accessibility、Browser 和 Release 验证完成后，才能删除旧 Owner；
- 不机械地让“一份旧 JS 对应一份新 TS”；
- 删除旧实现必须在对应 Issue 范围内明确授权。

## 二十五、禁止事项

禁止引入：

1. Gutenberg 编辑器替代、Next.js、Webpack、其他前端框架或替代发布后端。
2. React 19 专属 API、私有 React Runtime、Hydration、RSC 或 Server Action。
3. 浏览器正式 Markdown Renderer 或 CSS Security Parser。
4. 第二套 Canonical Document、Save、Publish、Revision、Media 或 Settings Authority。
5. Component 直接访问 WordPress DOM、jQuery、`wp.apiFetch`、`wp.media`、Storage、Clipboard 或 Global Bootstrap。
6. 万能 Adapter、God Component、共享 Root Store 或无结构 Component Directory。
7. Feature 私有路径导入、Upward Import、Broad Barrel 或 Circular Dependency。
8. 允许不可能状态的 Boolean Prop 组合或承载整篇高频 Document State 的 Broad Context。
9. 用 `useEffect` 镜像两份 React State。
10. Silent Fallback、Swallowed Error、Fake Success、Hidden Write、Force Click Disabled Control 或 Mutation 自动重试。
11. Stale Async Work 更新当前状态。
12. 无 Cleanup、Idempotence 和重复生命周期安全的 Effect。
13. Browser-local Scheduling 覆盖 WordPress Site Timezone。
14. 只支持 Built-in Command、破坏扩展 Registry 的实现。
15. TypeScript 源码放入 `assets/`。
16. Root-relative Plugin Asset URL、硬编码 Plugin Directory、Remote Runtime CDN、Production Dev Server 或 Telemetry。
17. Empty Feature Directory、Placeholder Module、Speculative Abstraction 和 Unused Asset。
18. Private Article、Custom CSS、AI Context、Nonce、Credential 和 Secret 写入 Diagnostics。
19. Source、Test、Cache、Log 或开发元数据进入安装包。
20. IIFE 输出与 Rollup Dynamic Chunk 同时被宣称为已定方案，却没有真实加载合同。
21. 将通用 Skill 规则置于 EasyMDE 项目合同之上。

## 二十六、完成门槛

一个 React 功能只有在以下条件与其范围相关的部分全部满足后，才可以报告完成：

1. 明确每个行为和状态值的单一 Owner。
2. 确认目录、Dependency Direction、Feature Public API 和命名。
3. 确认 Editor / Settings Root、Store、Provider、Error Boundary 和 Lifecycle 所有权。
4. 确认 Meta、Options、REST、Extension 和 Public Compatibility Contract。
5. 确认普通支持文章零写入打开。
6. 确认 Component 只使用 Typed Contract 和 Focused Port。
7. 确认 React 18、WordPress 6.7、`createRoot` Teardown 和无重复 React。
8. 确认 Native Field、Real Save / Publish Observation、Nonce Refresh、Lock Loss 和 Dirty Baseline。
9. 确认 Permission、Validation、Cancellation、Stale Result、Missing Control、Schema 和 Dependency Failure。
10. 确认 Semantic HTML、Form、Dialog、Focus、Keyboard、Selection、IME、Undo、Scroll、RTL、Reduced Motion、Contrast 和 Zoom。
11. 性能结论有真实测量。
12. 执行当前路径可用的 Type、Lint、Unit、Contract、Integration、Browser、i18n 和 Release 检查。
13. 检查准确 Diff、Manifest、WordPress Asset Metadata、Bundle 和安装 ZIP。
14. 报告实际验证、未验证内容和剩余风险，不编造证据。
