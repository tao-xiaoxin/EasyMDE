# EasyMDE React 重构目录结构规范

## 一、重构范围

EasyMDE 的 React 重构只覆盖：

* WordPress 后台编辑器 UI
* 沉浸式写作工作区
* 工具栏和 Markdown 操作界面
* 大纲、预览和布局管理
* 主题与字体设置
* 自定义 CSS 管理
* 发布弹窗
* 历史版本
* 媒体选择和图片插入
* 本地草稿提示
* 微信复制
* 未来 AI 助手

以下部分继续由 PHP 和 WordPress 管理，不迁移到 React：

* 插件加载和 WordPress Hook
* 用户权限与 Nonce
* Markdown 服务端渲染
* HTML 安全过滤
* Custom CSS 安全解析
* REST Controller
* Post Meta 数据模型
* WordPress 修订版本
* 原生文章保存与发布
* 前台文章渲染
* 文章主题和代码主题注册
* WordPress 媒体库底层逻辑

最终架构应当是：

```text
PHP / WordPress
负责数据、安全、渲染、保存和发布
                 ↓
Typed Bootstrap Config + Ports
                 ↓
React Editor Application
负责界面、交互和临时状态
```

---

# 二、仓库根目录

推荐保留一个根 `package.json`，不要给 React 再建立第二个独立 npm 项目。

```text
EasyMDE/
├── easymde.php
├── composer.json
├── package.json
├── package-lock.json
│
├── src/                         PHP 生产代码
├── includes/                    PHP 兼容入口
├── templates/                   PHP 模板
│
├── frontend/                    React/TypeScript 源代码
├── assets/                      插件运行时资源和构建产物
├── scripts/                     构建、发布、i18n 脚本
├── languages/
├── tests/                       PHP、Node、E2E 测试
└── docs/
```

不建议建立：

```text
frontend/package.json
frontend/package-lock.json
```

原因：

1. 当前根 `package.json` 已参与插件版本一致性检查。
2. 两个 lockfile 会增加依赖和 CI 管理成本。
3. 发布脚本、前端构建和 Vendor 资源准备本来就在同一个 npm 工作流中。
4. Codex 更容易在一个依赖图和一套命令中工作。

---

# 三、React 源码目录

```text
frontend/
├── vite.config.ts
├── vitest.config.ts
├── tsconfig.json
├── eslint.config.js
│
├── src/
│   ├── entrypoints/
│   ├── app/
│   ├── contracts/
│   ├── domain/
│   ├── features/
│   ├── integrations/
│   ├── shared/
│   └── test/
│
└── README.md
```

这里采用七层结构：

```text
entrypoints
app
contracts
domain
features
integrations
shared
```

不要采用过重的完整 Feature-Sliced Design，也不要退化成只有：

```text
components/
hooks/
utils/
```

后者在 EasyMDE 功能继续增加后，很快会变成几十个互相不清楚归属的文件。

---

# 四、完整推荐目录

```text
frontend/src/
├── entrypoints/
│   └── admin-editor.tsx
│
├── app/
│   ├── EditorApp.tsx
│   ├── EditorProviders.tsx
│   ├── EditorErrorBoundary.tsx
│   ├── createEditorRuntime.ts
│   │
│   ├── store/
│   │   ├── createEditorStore.ts
│   │   ├── documentSlice.ts
│   │   ├── appearanceSlice.ts
│   │   ├── layoutSlice.ts
│   │   ├── sessionSlice.ts
│   │   └── selectors.ts
│   │
│   └── styles/
│       ├── tokens.css
│       ├── reset.css
│       └── editor-app.css
│
├── contracts/
│   ├── bootstrap.ts
│   ├── document-port.ts
│   ├── preview-port.ts
│   ├── appearance-port.ts
│   ├── publishing-port.ts
│   ├── revision-port.ts
│   ├── media-port.ts
│   ├── storage-port.ts
│   ├── clipboard-port.ts
│   └── editor-runtime.ts
│
├── domain/
│   ├── document/
│   │   ├── document.types.ts
│   │   ├── document-state.ts
│   │   ├── dirty-state.ts
│   │   ├── title.ts
│   │   └── dirty-state.test.ts
│   │
│   ├── markdown/
│   │   ├── commands.ts
│   │   ├── selection.ts
│   │   ├── outline.ts
│   │   ├── statistics.ts
│   │   ├── table.ts
│   │   ├── image-candidate.ts
│   │   └── *.test.ts
│   │
│   ├── appearance/
│   │   ├── appearance.types.ts
│   │   ├── appearance-state.ts
│   │   ├── font-stack.ts
│   │   └── appearance-state.test.ts
│   │
│   ├── publishing/
│   │   ├── publishing.types.ts
│   │   ├── publish-draft.ts
│   │   ├── category-tree.ts
│   │   ├── validation.ts
│   │   └── *.test.ts
│   │
│   └── revisions/
│       ├── revision.types.ts
│       └── revision-state.ts
│
├── features/
│   ├── workspace/
│   ├── title-editor/
│   ├── markdown-editor/
│   ├── live-preview/
│   ├── outline/
│   ├── toolbar/
│   ├── appearance/
│   ├── custom-css/
│   ├── publishing/
│   ├── revisions/
│   ├── media/
│   ├── local-drafts/
│   ├── wechat-export/
│   └── ai-assistant/
│
├── integrations/
│   ├── wordpress/
│   │   ├── bootstrap/
│   │   │   ├── readBootstrapConfig.ts
│   │   │   └── validateBootstrapConfig.ts
│   │   │
│   │   ├── document/
│   │   │   ├── WordPressDocumentAdapter.ts
│   │   │   ├── nativeFields.ts
│   │   │   └── titleBridge.ts
│   │   │
│   │   ├── publishing/
│   │   │   ├── WordPressPublishingAdapter.ts
│   │   │   ├── nativePublishFields.ts
│   │   │   └── publishPreflight.ts
│   │   │
│   │   ├── media/
│   │   │   └── WordPressMediaAdapter.ts
│   │   │
│   │   ├── revisions/
│   │   │   └── WordPressRevisionAdapter.ts
│   │   │
│   │   ├── api/
│   │   │   ├── apiFetchClient.ts
│   │   │   ├── previewApi.ts
│   │   │   ├── customCssApi.ts
│   │   │   └── revisionApi.ts
│   │   │
│   │   └── createWordPressRuntime.ts
│   │
│   ├── preview-runtime/
│   │   ├── PreviewEnhancementRunner.ts
│   │   ├── PreviewFeatureLoader.ts
│   │   ├── themeAssets.ts
│   │   └── previewErrors.ts
│   │
│   └── browser/
│       ├── LocalDraftStorage.ts
│       ├── LayoutStorage.ts
│       ├── BrowserClipboard.ts
│       └── browserCapabilities.ts
│
├── shared/
│   ├── ui/
│   │   ├── Button/
│   │   ├── IconButton/
│   │   ├── Dialog/
│   │   ├── Popover/
│   │   ├── Select/
│   │   ├── Toast/
│   │   ├── SplitPane/
│   │   ├── EmptyState/
│   │   └── Spinner/
│   │
│   ├── hooks/
│   │   ├── useAbortableTask.ts
│   │   ├── useEvent.ts
│   │   ├── useFocusReturn.ts
│   │   ├── useOutsidePointerDown.ts
│   │   └── useReducedMotion.ts
│   │
│   ├── icons/
│   │   ├── Icon.tsx
│   │   ├── icon-map.ts
│   │   └── icons.types.ts
│   │
│   ├── lib/
│   │   ├── invariant.ts
│   │   ├── assertNever.ts
│   │   ├── debounce.ts
│   │   ├── classNames.ts
│   │   ├── errors.ts
│   │   └── disposable.ts
│   │
│   └── types/
│       ├── async-state.ts
│       └── opaque.ts
│
└── test/
    ├── setup.ts
    ├── renderWithEditor.tsx
    ├── createMockRuntime.ts
    ├── fixtures/
    └── factories/
```

注意：这是一份目标结构，不代表要一次性创建所有目录。

禁止创建空目录、占位文件或未来可能使用的组件。只有当对应功能开始迁移时，才创建该 Feature。

---

# 五、各层职责

## 1. `entrypoints/`

只负责找到 DOM 根节点、读取启动配置、创建运行时并挂载 React。

```tsx
const rootNode = document.getElementById('easymde-react-root');

invariant(rootNode, 'EasyMDE React root was not found.');

const bootstrap = readBootstrapConfig();
const runtime = createWordPressRuntime(bootstrap);
const store = createEditorStore(bootstrap.initialState);

mountEditor(rootNode, {
  runtime,
  store,
});
```

这里不得包含：

* 发布业务逻辑
* REST 请求实现
* DOM 查询细节
* 主题切换
* 文章操作
* 对话状态
* 组件 JSX 细节

`admin-editor.tsx` 应尽量控制在约 50～100 行以内。

---

## 2. `app/`

负责整个 React 应用的装配：

* Provider
* Error Boundary
* 全局 Store
* 路由级或工作区级布局
* 全局 Toast
* 功能开关
* Runtime 注入
* 顶层生命周期

`app` 不实现 WordPress API，也不解析 Markdown。

---

## 3. `contracts/`

这是 EasyMDE React 架构最重要的一层。

现有原生代码已经有一个大型 `adapter`，React 重构不应该把它原封不动搬过去，而应该拆成多个能力接口。

例如：

```ts
export interface DocumentPort {
  getInitialDocument(): EditorDocument;
  updateSubmissionFields(document: EditorDocument): void;
  subscribeExternalTitle(
    listener: (title: string) => void,
  ): () => void;
}

export interface PreviewPort {
  render(request: PreviewRequest): Promise<PreviewResult>;
  enhance(
    element: HTMLElement,
    features: PreviewFeatures,
  ): Promise<void>;
}

export interface PublishingPort {
  readPublishState(): PublishState;
  validateNativeControls(draft: PublishDraft): PublishPreflight;
  publish(draft: PublishDraft): Promise<void>;
  saveDraft(): Promise<void>;
}

export interface MediaPort {
  openMediaLibrary(): Promise<MediaSelection | null>;
  uploadImage(file: File): Promise<UploadedMedia>;
}
```

最终组合为：

```ts
export interface EditorRuntime {
  document: DocumentPort;
  preview: PreviewPort;
  appearance: AppearancePort;
  publishing: PublishingPort;
  revisions: RevisionPort;
  media: MediaPort;
  storage: StoragePort;
  clipboard: ClipboardPort;
}
```

不要重新建立一个包含 30～50 个方法的 `EditorAdapter`。

拆分之后：

* React UI 不知道 WordPress DOM 的具体结构。
* UI 原型可以注入 Mock Runtime。
* WordPress 插件注入真实 Runtime。
* 单元测试不需要启动 WordPress。
* 某个能力修改不会影响整个适配器。

---

## 4. `domain/`

只放纯业务规则。

这一层禁止：

* React
* JSX
* DOM
* `window`
* `document`
* jQuery
* `wp.apiFetch`
* LocalStorage
* WordPress 字段选择器
* 网络请求

现有 `immersive-workspace.js` 中下列逻辑应迁移到这里：

```text
normalizeTitle
hasUnsavedWorkspaceChanges
parseOutline
calculateStats
normalizeTableDimensions
createTableMarkdown
createPublishCategoryTree
updatePublishCategorySelection
validatePublishDraft
findFirstLocalImageCandidate
```

这些函数目前已经通过 Node 测试验证为纯辅助能力，迁移成 TypeScript 后应该直接 import 测试，而不是再使用 VM 执行整份浏览器脚本。

---

## 5. `features/`

每个 Feature 对应一个用户能够理解的功能，而不是一个技术类型。

正确：

```text
features/publishing
features/revisions
features/custom-css
features/outline
```

不推荐：

```text
features/modals
features/forms
features/dropdowns
features/api
```

以发布功能为例：

```text
features/publishing/
├── ui/
│   ├── PublishDialog.tsx
│   ├── PublishSettings.tsx
│   ├── CategoryTree.tsx
│   └── VisibilitySettings.tsx
│
├── model/
│   ├── usePublishDraft.ts
│   ├── usePublishAction.ts
│   └── publishing-state.ts
│
├── styles/
│   └── publishing.css
│
└── index.ts
```

Feature 内部文件不允许被其他 Feature 深层导入。

禁止：

```ts
import { CategoryTree } from '../publishing/ui/CategoryTree';
```

允许：

```ts
import { PublishDialog } from '@/features/publishing';
```

每个 Feature 的 `index.ts` 只导出明确的公共入口，不要导出所有内部文件。

---

## 6. `integrations/`

所有外部系统和浏览器环境访问集中放在这里。

包括：

* WordPress 原生标题字段
* WordPress 隐藏表单字段
* `#publish`、`#save-post`
* 分类和标签表单
* Featured Image
* WordPress 媒体库
* REST API
* `wp.apiFetch`
* LocalStorage
* Clipboard
* Preview Enhancement
* Highlight.js、Mermaid、KaTeX 加载
* WordPress 页面生命周期

React 组件中禁止出现：

```ts
document.querySelector('#publish')
$('#title')
window.wp.apiFetch(...)
window.EasyMDEConfig
```

这些只能出现在 `integrations/` 或最外层启动代码中。

---

## 7. `shared/`

只放真正跨多个 Feature 使用、且不包含 EasyMDE 业务语义的内容。

可以放：

* Button
* Dialog
* Popover
* Toast
* 通用焦点管理 Hook
* `invariant`
* `assertNever`
* 通用图标包装器

不应该放：

```text
PublishButton
ThemeSelector
RevisionItem
MarkdownToolbar
AiMessage
```

这些有明确业务含义，必须属于对应 Feature。

---

# 六、现有文件迁移映射

```text
现有文件
                                  目标位置

assets/js/admin/bootstrap.js
→ entrypoints/admin-editor.tsx
→ app/createEditorRuntime.ts
→ integrations/wordpress/*

assets/js/admin/immersive-workspace.js
→ features/workspace/*
→ features/publishing/*
→ features/revisions/*
→ features/appearance/*
→ features/outline/*
→ domain/markdown/*
→ domain/publishing/*

assets/js/admin/editor-state.js
→ domain/document/*
→ app/store/documentSlice.ts

assets/js/admin/commands.js
→ domain/markdown/commands.ts
→ features/toolbar/

assets/js/admin/preview-client.js
→ integrations/wordpress/api/previewApi.ts
→ features/live-preview/

assets/js/admin/preview-feature-loader.js
→ integrations/preview-runtime/

assets/js/admin/theme-manager.js
→ domain/appearance/*
→ features/appearance/
→ integrations/preview-runtime/themeAssets.ts

assets/js/admin/toolbar.js
→ features/toolbar/
→ shared/ui/

assets/js/admin/draft-storage.js
→ integrations/browser/LocalDraftStorage.ts
→ features/local-drafts/

assets/js/admin/media-picker.js
→ integrations/wordpress/media/
→ features/media/

assets/js/admin/image-paste.js
→ features/media/
→ integrations/wordpress/media/

assets/js/admin/wechat-exporter.js
→ features/wechat-export/
→ integrations/browser/BrowserClipboard.ts
```

不要机械地“一份旧 JS 对应一份新 TS”。

旧文件混合了多种职责，应该按领域和能力重新拆分。

---

# 七、PHP 目录调整

PHP 主体保持现有结构，但建议把 `AdminAssets.php` 中的配置组装职责分离出来。

```text
src/Admin/
├── AdminAssets.php
├── EditorBootstrapData.php
├── EditorScreen.php
├── EditorSaveHandler.php
├── PostModeController.php
└── SettingsPage.php
```

职责：

```text
AdminAssets
只负责 enqueue React JS/CSS 和必要 WordPress 依赖

EditorBootstrapData
负责生成传给 React 的结构化启动数据

EditorScreen
准备文章和初始预览上下文，渲染模板

EditorSaveHandler
继续负责原生 WordPress 保存
```

`EditorBootstrapData` 可以包含：

```php
[
    'version'       => 1,
    'post'          => [...],
    'document'      => [...],
    'appearance'    => [...],
    'features'      => [...],
    'endpoints'     => [...],
    'storage'       => [...],
    'commands'      => [...],
    'shortcuts'     => [...],
    'publishing'    => [...],
    'strings'       => [...],
]
```

必须提供 `version` 字段。

React 启动时先验证配置版本，不兼容时立即报错，不允许静默使用空对象兜底。

---

# 八、模板结构

`templates/admin/editor-shell.php` 不应该让 React 直接接管 WordPress 整个页面。

推荐保留 WordPress 原生表单桥接字段：

```php
<div id="easymde-editor-bridge" hidden>
    <textarea
        id="easymde-markdown-field"
        name="easymde_markdown"
    ></textarea>

    <input
        id="easymde-markdown-theme-field"
        name="easymde_markdown_theme"
        type="hidden"
    >

    <!-- 其他主题和字体字段 -->
</div>

<div
    id="easymde-react-root"
    data-post-id="..."
></div>
```

数据流：

```text
PHP 初始化数据
      ↓
React Store
      ↓
用户编辑
      ↓
WordPressDocumentAdapter
      ↓
同步原生表单字段
      ↓
WordPress 原生保存或发布
```

React Store 是浏览器编辑会话中的界面状态中心。

隐藏字段是 WordPress 表单提交桥梁，不是第二套业务状态中心。

PHP Post Meta 才是最终持久化状态。

---

# 九、状态管理规范

推荐使用一个轻量全局 Store，例如 Zustand，并按 Slice 拆分。

```text
documentSlice
保存 title、markdown、初始基线和 dirty 状态

appearanceSlice
保存文章主题、代码主题、字体、自定义 CSS 选择

layoutSlice
保存面板宽度、当前视图、大纲状态、AI 面板状态

sessionSlice
保存当前弹窗、异步状态、Toast、错误状态
```

不要把所有状态放进一个巨大对象。

不要把所有状态都放入全局 Store。

以下状态应留在组件内部：

* 弹窗中尚未提交的输入
* Select 临时搜索词
* Hover 状态
* Popover 开关
* 表单局部校验提示
* 临时拖拽状态
* AI 输入框草稿

以下状态适合全局 Store：

* Markdown
* 标题
* 当前主题
* 工作区布局
* 当前视图
* 跨多个 Feature 使用的文章状态
* 当前选中的历史版本
* AI 会话标识

可计算的数据不得重复保存：

```ts
const dirty =
  markdown !== initialMarkdown ||
  title !== initialTitle;
```

不要再创建：

```ts
setDirty(true);
```

否则容易出现状态不一致。

---

# 十、Markdown 编辑器状态

Markdown 输入属于高频状态，必须避免每次输入导致整个 React 应用重新渲染。

规范：

1. Markdown Store 使用 selector 订阅。
2. 工具栏不要直接订阅整篇 Markdown。
3. 字数统计使用延迟或派生 selector。
4. Preview 请求防抖。
5. 上一次 Preview 请求使用 `AbortController` 取消。
6. Preview 响应必须带请求序号或签名检查。
7. 旧响应不得覆盖新文章状态。
8. 编辑器选区、IME、滚动和 Undo 历史不能因为 React 重渲染丢失。
9. 不要在每次渲染时重建编辑器实例。
10. 编辑器实例通过 Ref 和 Feature Adapter 管理。

---

# 十一、预览架构

PHP 的 `MarkdownRenderer` 继续是唯一正式 Markdown 渲染器。

```text
Markdown
   ↓
PreviewPort.render()
   ↓
easymde/v1/preview
   ↓
PHP MarkdownRenderer
   ↓
已清洗 HTML + Feature 信息
   ↓
React Preview Surface
   ↓
Mermaid / KaTeX / Highlight Enhancement
```

React 中禁止引入另一套 Markdown Renderer 生成正式预览。

否则会出现：

```text
React 预览 HTML
≠
WordPress 保存后的 post_content
```

浏览器端只允许在服务器不可用时显示明确的错误状态，不得悄悄切换到另一套“近似渲染”。

---

# 十二、CSS 结构

第一阶段不要立即重命名整个 `immersive-workspace.css`。

推荐做法：

```text
frontend/src/app/styles/
├── tokens.css
├── reset.css
└── editor-app.css

frontend/src/features/workspace/styles/
├── workspace.css
├── header.css
├── layout.css
└── responsive.css

frontend/src/features/publishing/styles/
└── publishing.css

frontend/src/features/appearance/styles/
└── appearance.css
```

迁移原则：

1. 首轮迁移保留现有 BEM 类名，减少视觉回归。
2. 按 Feature 拆分 CSS 文件，但不要同时重写全部选择器。
3. 所有编辑器 UI 必须限定在稳定根节点下。
4. 前台文章主题类名保持不变。
5. 不允许使用全局 `button`、`input`、`textarea` 覆盖 WordPress。
6. 不用大量 `!important` 修补错误父布局。
7. 新组件可以使用 CSS Modules，但不要强制一次性改造旧样式。
8. 稳定的公共状态使用 `data-*` 属性表达。

例如：

```html
<div
  class="easymde-editor-app"
  data-theme="light"
  data-view="split"
  data-outline="expanded"
>
```

---

# 十三、构建产物目录

React 源码不能放在 `assets/` 下，因为 `assets/` 是插件运行时目录，会整体进入安装包。

推荐输出：

```text
assets/build/admin-editor/
├── editor.js
├── editor.css
└── manifest.json
```

或：

```text
assets/build/
├── admin-editor.js
├── admin-editor.css
└── admin-editor-manifest.json
```

构建文件名建议保持稳定，不使用每次变化的随机 Hash。

WordPress 已经可以通过：

```php
EASYMDE_VERSION
```

或文件修改时间处理缓存版本。

第三方本地运行时资源继续保留：

```text
assets/vendor/
├── highlight/
├── mermaid/
├── katex/
├── inter/
├── jetbrains-mono/
└── lucide/
```

不要把 Vite 编译产物放进 `assets/vendor/`。

---

# 十四、npm 脚本

根 `package.json` 推荐增加：

```json
{
  "scripts": {
    "dev:editor": "vite --config frontend/vite.config.ts",
    "build:editor": "vite build --config frontend/vite.config.ts",
    "typecheck:editor": "tsc -p frontend/tsconfig.json --noEmit",
    "lint:editor": "eslint frontend/src",
    "test:editor": "vitest run --config frontend/vitest.config.ts",
    "test:editor:watch": "vitest --config frontend/vitest.config.ts",
    "test:editor:ui": "vitest --ui --config frontend/vitest.config.ts",
    "build:release": "npm run build:editor && node scripts/build-release.mjs"
  }
}
```

原有脚本继续保留：

```text
prepare:assets
i18n:make-pot
i18n:compile
i18n:check
notices:write
notices:check
test
test:e2e
```

发布构建必须检查：

* React JS 构建产物存在
* React CSS 构建产物存在
* 安装 ZIP 中没有 `.tsx`、`.ts`、测试和 Source Map
* 安装 ZIP 中没有 `frontend/`
* 安装 ZIP 中没有 `node_modules`
* 本地字体、图标和 Preview Runtime 资源完整

---

# 十五、React Runtime 选择

EasyMDE React 重构后的最低支持版本为 WordPress 6.7。

该最低版本是 React 重构交付后的兼容性目标，不追溯改变重构完成前现有发布版本的支持承诺。正式交付依赖 WordPress 6.7 的 React Runtime 时，必须在同一个聚焦变更中同步插件头、WordPress.org `readme.txt`、公开 README、测试矩阵和发布检查；在这些发布边界同步完成前，不得提前把仅支持 WordPress 6.7 的运行时代码加载到现有兼容版本中。

WordPress 6.7 已通过 `@wordpress/element` 提供 `createRoot`，因此 React 编辑器应复用 WordPress 注册的 React Runtime，不在插件运行时 Bundle 中重复打包 React 和 ReactDOM。

推荐：

```text
React Runtime 使用 WordPress 提供的 @wordpress/element
```

条件：

* 后台编辑器构建产物声明 `wp-element` 为 WordPress 脚本依赖。
* 使用 `createRoot` 挂载，不使用已弃用的 `render`。
* React 只挂载到自己的根节点。
* 不把 EasyMDE React Element 传给 WordPress React 组件。
* 不混用 `@wordpress/components`。
* 不将 React Bundle 加载到无关后台页面。
* 只在 EasyMDE 编辑页面加载。
* 不使用当前项目不需要的 React major 专属 API。
* WordPress 6.7 和最新支持版本都必须覆盖挂载、卸载、重复进入退出和错误边界测试。

---

# 十六、测试目录规范

## 纯业务规则

和源码放在一起：

```text
domain/markdown/outline.ts
domain/markdown/outline.test.ts
```

使用 Vitest 直接 import。

不再通过正则检查源码文本来证明业务行为。

## React 组件

```text
features/publishing/ui/PublishDialog.tsx
features/publishing/ui/PublishDialog.test.tsx
```

使用：

* React Testing Library
* `user-event`
* 语义角色和 accessible name

测试用户行为，不测试内部 Hook 数量或私有 State。

## WordPress Adapter

```text
integrations/wordpress/publishing/
├── WordPressPublishingAdapter.ts
└── WordPressPublishingAdapter.test.ts
```

需要覆盖：

* 原生控件不存在
* 权限不足
* 发布按钮禁用
* 分类字段缺失
* Featured Image 不存在
* 重复发布
* 发布前同步失败
* 页面导航前清理

## E2E

继续保留现有：

```text
tests/e2e/
```

Playwright 必须对构建后的 Release ZIP 测试，而不是只测试 Vite Dev Server。

需要覆盖：

* 新文章
* 普通旧文章无写入打开
* 保存再打开
* 发布
* 修订恢复
* 图片上传
* 自定义 CSS
* 主题切换
* 本地草稿恢复
* 微信复制
* 沉浸式模式反复进入退出
* 焦点和快捷键
* IME 输入
* 大纲和分栏拖动
* 视觉回归截图

---

# 十七、代码依赖规则

允许的依赖方向：

```text
entrypoints
    ↓
app
    ↓
features
    ↓
domain / contracts / shared

integrations
    ↓
contracts / domain / shared
```

`app` 负责把 `features` 和 `integrations` 组合起来。

禁止：

```text
domain → React
domain → integrations
shared → features
feature A → feature B 的内部文件
component → window.wp
component → WordPress DOM
integration → React UI
```

跨 Feature 协作必须通过：

* App Store
* Domain Model
* Contract
* Feature 公共入口
* 明确的事件或 Action

不能互相查询 DOM。

---

# 十八、命名规范

组件：

```text
PascalCase.tsx
PublishDialog.tsx
RevisionList.tsx
MarkdownEditor.tsx
```

Hook：

```text
usePublishDraft.ts
usePreviewRequest.ts
useOutlineNavigation.ts
```

纯函数：

```text
calculateStatistics.ts
createCategoryTree.ts
validatePublishDraft.ts
```

Adapter：

```text
WordPressPublishingAdapter.ts
WordPressMediaAdapter.ts
LocalDraftStorage.ts
```

类型：

```text
publishing.types.ts
appearance.types.ts
```

CSS：

```text
publishing.css
revision-dialog.css
workspace-layout.css
```

测试：

```text
PublishDialog.test.tsx
category-tree.test.ts
WordPressPublishingAdapter.test.ts
```

---

# 十九、禁止事项

React 重构中明确禁止：

1. 使用 Next.js。
2. 把 PHP REST Controller 重写成浏览器逻辑。
3. 浏览器端重新实现正式 Markdown Renderer。
4. 把所有代码塞进 `components/`。
5. 创建一个新的超大 `EditorAdapter`。
6. 组件直接查询 WordPress DOM。
7. 组件直接访问 `window.EasyMDEConfig`。
8. 组件直接调用 `wp.apiFetch`。
9. 使用多个互相矛盾的布尔 State。
10. 用 `useEffect` 同步两个 React State。
11. 静默吞掉 REST、发布或配置错误。
12. 因为 React 化而改变 Post Meta 结构。
13. 因为 React 化而改变修订恢复语义。
14. 因为 React 化而绕过 WordPress 原生发布。
15. 在 `assets/` 中存放 TypeScript 源码。
16. 发布 ZIP 包含 React 测试和源码。
17. 一次性删除旧编辑器而没有可验证的迁移路径。
18. 提前创建尚未实现的 AI Assistant 空目录和占位组件。

---

# 二十、迁移阶段

## 阶段 1：建立构建基础

增加：

```text
frontend/
Vite
TypeScript
Vitest
React 入口
assets/build/
```

React 首先只渲染一个受控的测试壳，不接管文章。

验证：

* WordPress 6.7+
* PHP 7.4+
* React Bundle 正确加载
* 不影响其他后台页面
* Release ZIP 包含构建产物

## 阶段 2：提取纯逻辑

从原生 JS 提取：

* Outline
* Statistics
* Dirty State
* Table Markdown
* Publish Draft
* Category Tree
* Image Candidate
* Title Normalization

转成 TypeScript 并直接测试。

这一阶段不改 UI。

## 阶段 3：建立 Contracts 和 WordPress Runtime

把 `bootstrap.js` 中的 WordPress DOM 和 REST 操作迁移到：

```text
integrations/wordpress/
```

React UI 只依赖 Ports。

旧 UI 也可以暂时通过同一 Runtime 调用，以证明边界正确。

## 阶段 4：迁移独立 UI

推荐顺序：

```text
1. 主题和字体
2. 自定义 CSS
3. 历史版本
4. 发布弹窗
5. 大纲
6. 工具栏
7. 工作区布局
```

这些功能风险低于直接替换 Markdown 编辑器。

## 阶段 5：迁移工作区

React 接管：

* Header
* Title
* Source
* Preview
* Outline
* Status Bar
* Split Pane
* Dialog Layer

仍通过 WordPress Adapter 保存和发布。

## 阶段 6：清理旧实现

只有在以下全部通过后，才能删除旧 JS：

* PHP 测试
* TypeScript 类型检查
* React 单元测试
* Adapter 集成测试
* Release ZIP 检查
* Plugin Check
* Playwright
* 视觉对比
* WordPress 6.7 和最新版本测试
* 重复进入退出工作区测试
* 发布、修订、媒体和草稿测试

## 阶段 7：开发 AI 助手

AI 助手从一开始就作为 React Feature 实现，不再写原生 JS 版本。

但它必须保持独立边界：

```text
features/ai-assistant/
integrations/ai/
```

AI 不能直接修改文章 DOM。

所有文章修改必须生成明确的 Edit Operation，再由 Document Store 应用，确保：

* 可撤销
* 可预览
* 可拒绝
* 可审计
* 不破坏编辑器选区和 Undo 历史
