import { act } from '@testing-library/react';
import { vi } from 'vitest';

import type {
  PreviewFeatures,
  PreviewRequest,
  PreviewResponse,
  SafePreviewHtml
} from '../../contracts/ports/preview-request';
import type { ImageUploadResult } from '../../contracts/ports/image-upload-port';
import type { EditorClipboardPort } from '../../contracts/ports/editor-clipboard-port';
import type {
  EditorMarkdownBlockIndexData,
  EditorMarkdownBlockIndexPort,
  EditorMarkdownImageIndexData
} from '../../contracts/ports/editor-block-index-port';
import type { LocalDraftStoragePort } from '../../contracts/ports/local-drafts-port';
import type {
  EditorSessionAutosavePreparationResult,
  EditorSessionPort,
  EditorSessionStatus
} from '../../contracts/ports/editor-session-port';
import {
  customCssDialogStrings,
  customCssVariables
} from '../../test/fixtures/appearance-bootstrap';
import type { PreparedToolbarShortcutBinding } from '../../contracts/ports/toolbar-shortcuts-port';
import { createWordPressNativeSubmissionPort } from '../../integrations/wordpress/native-form/wordpress-native-submission';
import {
  createEditorMarkdownBlockIndex as createProfiledMarkdownBlockIndex
} from '../../features/editor-context-menu/editor-markdown-block-index';
import {
  findEditorCodeContentTarget as observedCodeContentTarget
} from '../../features/editor-context-menu/editor-code-content-target';
import type { EditorRootProps } from './EditorRoot';

const mountedFields: Array<HTMLElement> = [];
const previewGeometrySurfaces = new Set<HTMLElement>();
let previewGeometryPrototypeInstalled = false;

export const contextMenuStrings = {
  alignCenter: 'Align center',
  alignLeft: 'Align left',
  alignRight: 'Align right',
  alignment: 'Alignment',
  ariaLabel: 'Editor context menu',
  bold: 'Bold',
  codeBlock: 'Code block',
  copy: 'Copy',
  copyAsHtml: 'Copy as HTML code',
  copyAsMarkdown: 'Copy as Markdown',
  copyCodeBlock: 'Copy code block',
  copyCodeContent: 'Copy Code Block Content',
  indentCodeBlock: 'Adjust Code Block Indentation',
  indentSelectedCode: 'Adjust Selected Code Indentation',
  copyDiagramSource: 'Copy code',
  copyGeneratedImage: 'Copy as image',
  copyGeneratedMathMl: 'Copy MathML',
  copyImage: 'Copy image',
  copyLinkAddress: 'Copy link address',
  copyPasteAs: 'Copy / Paste as',
  copyMathSource: 'Copy TeX',
  copySimplifiedFormatting: 'Copy with simplified formatting',
  copyTable: 'Copy table',
  formatTableSource: 'Format Table Source',
  cut: 'Cut',
  deleteCodeBlock: 'Delete code block',
  deleteColumn: 'Delete column',
  deleteGeneratedContent: 'Delete',
  deleteImage: 'Delete image',
  deleteRow: 'Delete row',
  deleteTable: 'Delete table',
  deleteThematicBreak: 'Delete horizontal rule',
  diagramBlock: 'Diagram',
  editGeneratedContent: 'Edit',
  image: 'Image',
  imageScale: 'Image scale',
  insert: 'Insert',
  insertAbove: 'Insert paragraph above',
  insertBelow: 'Insert paragraph below',
  insertCodeAbove: 'Insert paragraph above code block',
  insertCodeBelow: 'Insert paragraph below code block',
  insertImageAbove: 'Insert image above',
  insertImageBelow: 'Insert image below',
  insertColumnLeft: 'Insert column left',
  insertColumnRight: 'Insert column right',
  insertParagraphAboveGenerated: 'Insert paragraph above',
  insertParagraphAboveTable: 'Insert paragraph above table',
  insertParagraphBelowGenerated: 'Insert paragraph below',
  insertParagraphBelowTable: 'Insert paragraph below table',
  insertTableAbove: 'Insert table above',
  insertTableBelow: 'Insert table below',
  insertRowAbove: 'Insert row above',
  insertRowBelow: 'Insert row below',
  mathBlock: 'Formula',
  paste: 'Paste',
  pastePlainText: 'Paste as plain text',
  statusActionFailed: 'The editor action could not be completed.',
  statusClipboardUnavailable: 'Clipboard unavailable.',
  table: 'Table',
  unsupported: 'Unsupported for this selection.',
  uploadImage: 'Upload image'
} as const;

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, reject, resolve };
}

export function layoutContextMenuSurface(
  surface: HTMLElement,
  options: Readonly<{ keepLivePreviewGeometry?: boolean }> = {}
): void {
  const workspace = surface
    .closest<HTMLElement>('.easymde-editor')
    ?.querySelector<HTMLElement>('.easymde-workspace');
  const previewCanvas = surface.parentElement?.classList.contains(
    'easymde-immersive-preview-canvas'
  )
    ? surface.parentElement
    : null;
  const boundary =
    workspace ?? previewCanvas ?? surface.parentElement ?? surface;
  const viewportRect = {
    bottom: 600,
    height: 600,
    left: 0,
    right: 800,
    top: 0,
    width: 800,
    x: 0,
    y: 0,
    toJSON: () => ({})
  };
  for (const element of new Set([
    boundary,
    previewCanvas,
    surface.parentElement ?? surface
  ])) {
    if (!element) continue;
    Object.defineProperty(element, 'getBoundingClientRect', {
      configurable: true,
      value: () => viewportRect
    });
  }

  if (!surface.hasAttribute('data-easymde-preview-html-sink')) return;
  if (!options.keepLivePreviewGeometry) return;

  previewGeometrySurfaces.add(surface);
  if (options.keepLivePreviewGeometry && !previewGeometryPrototypeInstalled) {
    const originalGetBoundingClientRect =
      HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      function (this: HTMLElement) {
        for (const registeredSurface of previewGeometrySurfaces) {
          if (this.parentElement !== registeredSurface) continue;
          const isSpacer = this.hasAttribute(
            'data-easymde-preview-window-spacer'
          );
          const isBlock = this.hasAttribute('data-easymde-visual-block-id');
          if (!isSpacer && !isBlock) continue;
          const children = Array.from(registeredSurface.children).filter(
            (child): child is HTMLElement => child instanceof HTMLElement
          );
          let top = 0;
          for (const child of children) {
            const childHeight = child.hasAttribute(
              'data-easymde-preview-window-spacer'
            )
              ? Number.parseFloat(child.style.blockSize)
              : child.hasAttribute('data-easymde-visual-block-id')
                ? 24
                : 0;
            if (!Number.isFinite(childHeight) || childHeight <= 0) continue;
            if (child === this) {
              if (!isSpacer) {
                child.style.marginBlockStart = '0px';
                child.style.marginBlockEnd = '0px';
              }
              return {
                bottom: top + childHeight,
                height: childHeight,
                left: 0,
                right: 800,
                top,
                width: 800,
                x: 0,
                y: top,
                toJSON: () => ({})
              } as DOMRect;
            }
            top += childHeight;
          }
        }
        return originalGetBoundingClientRect.call(this);
      }
    );
    previewGeometryPrototypeInstalled = true;
  }

  const children = Array.from(surface.children).filter(
    (child): child is HTMLElement => child instanceof HTMLElement
  );
  let top = 0;
  for (const child of children) {
    const isSpacer = child.hasAttribute('data-easymde-preview-window-spacer');
    const declaredHeight = isSpacer
      ? Number.parseFloat(child.style.blockSize)
      : 24;
    if (!Number.isFinite(declaredHeight) || declaredHeight <= 0) continue;
    child.style.marginBlockStart = '0px';
    child.style.marginBlockEnd = '0px';
    Object.defineProperty(child, 'offsetHeight', {
      configurable: true,
      value: declaredHeight
    });
    const childTop = top;
    Object.defineProperty(child, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        bottom: childTop + declaredHeight,
        height: declaredHeight,
        left: 0,
        right: 800,
        top: childTop,
        width: 800,
        x: 0,
        y: childTop,
        toJSON: () => ({})
      })
    });
    top += declaredHeight;
  }
  const surfaceRect = {
    bottom: top,
    height: top,
    left: 0,
    right: 800,
    top: 0,
    width: 800,
    x: 0,
    y: 0,
    toJSON: () => ({})
  };
  Object.defineProperty(surface, 'getBoundingClientRect', {
    configurable: true,
    value: options.keepLivePreviewGeometry
      ? () => {
          let height = 0;
          for (const child of Array.from(surface.children)) {
            if (!(child instanceof HTMLElement)) continue;
            const childHeight = child.hasAttribute(
              'data-easymde-preview-window-spacer'
            )
              ? Number.parseFloat(child.style.blockSize)
              : child.hasAttribute('data-easymde-visual-block-id')
                ? 24
                : 0;
            if (Number.isFinite(childHeight) && childHeight > 0)
              height += childHeight;
          }
          return {
            ...surfaceRect,
            bottom: height,
            height
          };
        }
      : () => surfaceRect
  });
  Object.defineProperty(surface, 'offsetHeight', {
    configurable: true,
    value: top
  });
}

export type QueuedAnimationFrames = {
  callbacks: Map<number, FrameRequestCallback>;
  restore: () => void;
};

export function createQueuedAnimationFrames(): QueuedAnimationFrames {
  const callbacks = new Map<number, FrameRequestCallback>();
  let nextId = 1;
  const requestAnimationFrame = vi
    .spyOn(window, 'requestAnimationFrame')
    .mockImplementation((callback: FrameRequestCallback) => {
      const id = nextId;
      nextId += 1;
      callbacks.set(id, callback);
      return id;
    });
  const cancelAnimationFrame = vi
    .spyOn(window, 'cancelAnimationFrame')
    .mockImplementation((id: number) => {
      callbacks.delete(id);
    });
  return {
    callbacks,
    restore: () => {
      requestAnimationFrame.mockRestore();
      cancelAnimationFrame.mockRestore();
    }
  };
}

export async function drainAnimationFrameBatch(
  frameQueue: QueuedAnimationFrames,
  timestamp: number
): Promise<boolean> {
  const batch = [...frameQueue.callbacks.entries()];
  if (0 === batch.length) return false;
  await act(async () => {
    for (const [id] of batch) {
      const callback = frameQueue.callbacks.get(id);
      if (!callback) continue;
      frameQueue.callbacks.delete(id);
      callback(timestamp);
    }
    await Promise.resolve();
  });
  return true;
}

export function createPreviewResponse(
  request: PreviewRequest,
  html: SafePreviewHtml,
  features: PreviewFeatures
): PreviewResponse {
  const template = document.createElement('template');
  template.innerHTML = html;
  const lineCount = Math.max(1, request.markdown.split(/\r\n|\r|\n/).length);
  const blocks = Array.from(template.content.children).map((element, index) => {
    const id = `b${index}`;
    element.setAttribute('data-easymde-visual-block-id', id);
    const hasSourceLines = index < lineCount;
    return {
      id,
      startLine: hasSourceLines ? index : lineCount,
      endLine: hasSourceLines ? index + 1 : lineCount,
      editable: hasSourceLines
    } as const;
  });

  return {
    features,
    html: template.innerHTML as SafePreviewHtml,
    editMap: {
      version: 1,
      coordinate: 'line',
      signature: request.signature,
      blocks
    }
  };
}

export function createCodeContentPreviewResponse(
  request: PreviewRequest,
  source: string,
  selection: number,
  content: string
): PreviewResponse {
  const target = observedCodeContentTarget(
    source,
    { end: selection, start: selection }
  );
  if ('unavailable' === target.status) {
    throw new Error(target.code);
  }
  const response = createPreviewResponse(
    request,
    '<pre><code>const value = 1;\n</code></pre>' as SafePreviewHtml,
    {}
  );
  return {
    ...response,
    codeMap: {
      coordinate: 'line',
      entries: [{
        content,
        endLine: target.target.lineEnd - target.target.ownerLineStart,
        kind: target.target.kind,
        startLine: target.target.lineStart - target.target.ownerLineStart,
        status: 'available'
      }],
      signature: request.signature,
      status: 'available',
      version: 1
    }
  };
}

export function createCodeIndentationPreviewResponse(
  request: PreviewRequest,
  source: string,
  content: string
): PreviewResponse {
  const response = createCodeContentPreviewResponse(
    request,
    source,
    source.indexOf('return'),
    content
  );
  return {
    ...response,
    codeProjection: {
      coordinate: 'line',
      entries: [{
        endLine: 5,
        fenceOffset: 0,
        info: 'javascript',
        kind: 'fenced',
        rows: [
          {
            contentLine: 0,
            literalFrom: 0,
            literalLeadingSpaces: 0,
            prefixEnd: 0,
            prefixTabColumns: 0,
            sourceLine: 1
          },
          {
            contentLine: 1,
            literalFrom: 0,
            literalLeadingSpaces: 0,
            prefixEnd: 0,
            prefixTabColumns: 0,
            sourceLine: 2
          },
          {
            contentLine: 2,
            literalFrom: 0,
            literalLeadingSpaces: 0,
            prefixEnd: 0,
            prefixTabColumns: 0,
            sourceLine: 3
          }
        ],
        startLine: 0,
        status: 'available'
      }],
      offsetUnit: 'utf16',
      signature: request.signature,
      status: 'available',
      version: 1
    }
  };
}

export function createSourceLinkPreviewResponse(
  request: PreviewRequest,
  href: string,
  includeAnchor = true
): PreviewResponse {
  return createPreviewResponse(
    request,
    (includeAnchor
      ? `<p><a href="${href}">caption</a></p><p>canonical</p>`
      : '<p>canonical</p><p>without anchor</p>') as SafePreviewHtml,
    {}
  );
}

export function sourceLinkParser(): NonNullable<EditorRootProps['simplifiedFormattingParser']> {
  return {
    parseFromString: (source, mimeType) =>
      new DOMParser().parseFromString(source, mimeType)
  };
}

export function sourceLinkBlockIndexPort(): EditorMarkdownBlockIndexPort {
  return {
    build: vi.fn(async ({ source }) => observedBlockIndex(source)),
    dispose: vi.fn()
  };
}

export function imageBlockIndexData(
  source: string
): EditorMarkdownBlockIndexData & EditorMarkdownImageIndexData {
  const blocks: Array<{
    editable: true;
    from: number;
    kind: 'paragraph';
    lineEnd: number;
    lineStart: number;
    to: number;
  }> = [];
  let lineStart = 0;
  let line = 0;
  while (lineStart < source.length || (0 === source.length && 0 === line)) {
    const newline = source.slice(lineStart).search(/\r\n|\r|\n/u);
    const lineLength = newline < 0 ? source.length - lineStart : newline;
    blocks.push({
      editable: true,
      from: lineStart,
      kind: 'paragraph',
      lineEnd: line,
      lineStart: line,
      to: lineStart + lineLength
    });
    if (newline < 0) break;
    const newlineLength = source.startsWith('\r\n', lineStart + lineLength)
      ? 2
      : 1;
    lineStart += lineLength + newlineLength;
    line += 1;
  }
  const imageRanges: Array<{ from: number; to: number }> = [];
  let searchFrom = 0;
  while (searchFrom < source.length) {
    const start = source.indexOf('![', searchFrom);
    if (start < 0) break;
    const end = source.indexOf(')', start) + 1;
    if (end <= start) break;
    imageRanges.push({ from: start, to: end });
    searchFrom = end;
  }
  let nextImageIndex = 0;
  const imageBlocks = blocks.map((block) => {
    const firstImageIndex = nextImageIndex;
    while (nextImageIndex < imageRanges.length) {
      const range = imageRanges[nextImageIndex];
      if (!range || range.from < block.from || range.to > block.to) break;
      nextImageIndex += 1;
    }
    const count = nextImageIndex - firstImageIndex;
    return {
      count,
      firstImageIndex,
      status: 'ready' as const
    };
  });
  return {
    blocks,
    imageBlocks,
    imageRanges,
    length: source.length,
    mathSpans: []
  };
}

export function imageBlockIndexPort(): EditorMarkdownBlockIndexPort {
  return {
    build: vi.fn(async ({ source }) => imageBlockIndexData(source)),
    dispose: vi.fn()
  };
}

export function BrokenEditorRoot(): never {
  throw new Error('synthetic editor-root render failure');
}

export function fixture(): EditorRootProps &
  Readonly<{
    localDraftStorage: LocalDraftStoragePort;
    nativeForm: HTMLFormElement;
    scrollSyncBinding: Readonly<{
      activate: ReturnType<typeof vi.fn>;
      dispose: ReturnType<typeof vi.fn>;
    }>;
    shortcutBinding: PreparedToolbarShortcutBinding;
    sessionAutosave: () => EditorSessionAutosavePreparationResult;
    sessionEmit: (status: EditorSessionStatus) => void;
    getPreviewLayoutObservationCount: () => number;
    triggerResize: () => void;
    triggerPreviewLayout: () => void;
    // The fixture always supplies the Clipboard port, so rows that assert on it
    // read it without an optional chain. The production prop itself stays
    // optional for callers that genuinely have no Clipboard.
    editorClipboardPort: EditorClipboardPort;
  }> {
  const submissionField = document.createElement('textarea');
  const titleField = document.createElement('input');
  const nativeForm = document.createElement('form');
  submissionField.value = 'selected';
  submissionField.defaultValue = 'selected';
  submissionField.setSelectionRange(0, 8);
  titleField.value = 'Synthetic title';
  titleField.defaultValue = 'Synthetic title';
  nativeForm.append(submissionField, titleField);
  document.body.append(nativeForm);
  mountedFields.push(nativeForm);
  const shortcutBinding = {
    activate: vi.fn(),
    dispose: vi.fn()
  };
  const mediaFrame = {
    attachFrame: vi.fn(() => vi.fn()),
    close: () => undefined,
    frameUrl: 'https://example.test/media-picker',
    open: vi.fn(),
    select: (_attachment: unknown) => undefined
  };
  mediaFrame.open.mockImplementation((options) => {
    mediaFrame.close = options.onClose;
    mediaFrame.select = options.onSelect;
  });
  const localDraftStorage: LocalDraftStoragePort = {
    discard: vi.fn(() => ({ status: 'discarded' as const })),
    fingerprint: vi.fn((content) => `hash:${content}`),
    formatTime: vi.fn(() => ({ status: 'formatted' as const, value: '12:34' })),
    read: vi.fn(() => ({ status: 'missing' as const })),
    subscribe: vi.fn(() => vi.fn()),
    write: vi.fn(() => ({ status: 'saved' as const, updatedAt: 1234 }))
  };
  const editorClipboardPort: EditorClipboardPort = {
    check: vi
      .fn()
      .mockResolvedValue({ status: 'available', text: 'clipboard' }),
    dispose: vi.fn(),
    getState: vi.fn(() => ({ status: 'available' as const })),
    read: vi.fn().mockResolvedValue({ status: 'available', text: 'clipboard' }),
    subscribe: vi.fn(() => vi.fn()),
    write: vi.fn().mockResolvedValue({ status: 'written' }),
    writeDeferred: vi.fn().mockResolvedValue({ status: 'written' })
  };
  const scrollSyncBinding = { activate: vi.fn(), dispose: vi.fn() };
  const sessionListeners = new Set<() => void>();
  const sessionAutosaveListeners = new Set<
    () => EditorSessionAutosavePreparationResult
  >();
  let resizeListener: (() => void) | null = null;
  let previewLayoutListener: (() => void) | null = null;
  let previewLayoutObservationCount = 0;
  let sessionSnapshot = { status: 'ready' as EditorSessionStatus };
  const sessionPort: EditorSessionPort = {
    getSnapshot: () => sessionSnapshot,
    subscribeBeforeAutosave: vi.fn((listener) => {
      sessionAutosaveListeners.add(listener);
      return () => sessionAutosaveListeners.delete(listener);
    }),
    subscribe: vi.fn((listener) => {
      sessionListeners.add(listener);
      return () => sessionListeners.delete(listener);
    })
  };

  return {
    contextMenuStrings,
    editorClipboardPort,
    appearance: {
      articleThemes: [
        {
          id: 'default',
          label: 'Default',
          defaultCodeTheme: 'atom-one-dark',
          markupProfile: 'common-v1'
        },
        {
          id: 'newsprint',
          label: 'Newsprint',
          defaultCodeTheme: 'atom-one-dark',
          markupProfile: 'common-v1'
        }
      ],
      canManageCustomCss: true,
      codeThemeExplicit: false,
      customMarkupProfile: 'common-v1',
      codeThemes: [
        { id: 'atom-one-dark', label: 'Atom One Dark' },
        { id: 'github', label: 'GitHub' }
      ],
      customCss: [],
      customCssVariables,
      state: {
        codeTheme: 'atom-one-dark',
        customCssId: '',
        markdownTheme: 'default'
      },
      strings: {
        appearance: 'Appearance',
        articleTheme: 'Article theme',
        codeTheme: 'Code theme',
        cssName: 'CSS name',
        cssSaveFailed: 'CSS save failed',
        cssNameDuplicate: 'A theme with this name already exists',
        cssSaved: 'CSS saved',
        themeApplyFailed:
          'Theme could not be applied. The saved theme is still available.',
        customCss: 'Custom CSS',
        customCssTheme: 'Custom CSS theme',
        customCssDialog: customCssDialogStrings,
        namedCustomCss: 'Named CSS',
        saveCss: 'Save CSS'
      }
    },
    appearancePort: {
      applyState: vi.fn().mockResolvedValue(true),
      cancelPendingApply: vi.fn(),
      closeOtherPopovers: vi.fn(),
      dispose: vi.fn(),
      previewCustomCss: vi.fn().mockResolvedValue({
        scopedCss: '',
        status: 'ready'
      }),
      saveCustomCss: vi
        .fn()
        .mockResolvedValue({ status: 'failed', code: 'synthetic' })
    },
    document: { editorLabel: 'Markdown source' },
    referenceLabelCaseFoldProfile: 14,
    enhancementPort: {
      dispose: vi.fn(),
      enhance: vi.fn().mockResolvedValue(undefined),
      prepareCodeTheme: vi.fn().mockResolvedValue({
        cancel: vi.fn(),
        commit: vi.fn()
      }),
      scopeRenderedStyles: vi.fn(() => ({ dispose: vi.fn() })),
      syncCodeFrameBackgrounds: vi.fn()
    },
    executeExternalCommand: vi.fn(),
    fontControlsPort: { applyState: vi.fn(), closeOtherPopovers: vi.fn() },
    fonts: {
      options: {
        appleFonts: [{ fontFamily: '', id: 'system', label: 'System' }],
        customFonts: [{ fontFamily: '', id: 'none', label: 'None' }],
        serifOptions: [{ fontFamily: '', id: 'off', label: 'Off' }],
        windowsFonts: [{ fontFamily: '', id: 'system', label: 'System' }]
      },
      state: {
        appleFont: 'system',
        customFont: 'none',
        serifFont: 'off',
        windowsFont: 'system'
      },
      strings: {
        appleFont: 'Apple font',
        customFont: 'Custom font',
        font: 'Font',
        fontStackHelp: 'Font stack help',
        serifFont: 'Serif',
        windowsFont: 'Windows font'
      }
    },
    immersiveStrings: {
      autoSave: '自动保存',
      autoSaveEnabled: '自动保存已开启',
      articleOutline: '文章大纲',
      cancel: '取消',
      close: '关闭',
      column: '列',
      edit: '编辑',
      editMode: '编辑模式',
      editorSettings: '编辑器设置',
      enter: '进入沉浸写作',
      expand: '展开',
      exit: '退出沉浸写作',
      hideOutline: '收起大纲',
      history: '历史记录',
      historyEmpty: '暂无修订版本',
      historyError: '无法加载修订版本',
      historyLoading: '正在加载修订版本',
      historyAll: '全部',
      historyVersions: '历史版本',
      immersive: '沉浸写作',
      insert: '插入',
      insertTable: '插入表格',
      line: '行',
      manualSave: '手动保存',
      moreActions: '更多操作',
      markdown: 'Markdown',
      noHeadings: '暂无标题',
      outline: '文章大纲',
      outlineDescription: '左侧显示标题层级导航',
      preview: '预览',
      previewContentLoaded: '内容已载入',
      previewChangesRecorded: '更改已记录',
      previewEditable: '可编辑',
      previewEditorLabel: '可视化文章编辑器',
      previewLockReadOnly: '锁定为只读',
      previewReadOnly: '只读',
      previewUnlockEdit: '解除锁定并编辑',
      previewMode: '预览模式',
      protectedCardEditFormat: '编辑 %s',
      protectedCardFootnotes: '脚注',
      protectedCardMath: '公式',
      protectedCardMermaid: 'Mermaid',
      protectedCardRaw: '原始块',
      protectedCardSave: '保存',
      protectedCardSourceFormat: '%s 源码',
      protectedCardToc: '目录',
      publish: '发布文章',
      restore: '恢复修订版本',
      restoreConfirm: '未保存的更改将会丢失',
      restoreThisVersion: '恢复到这个版本',
      resizeOutline: '调整大纲宽度',
      resizeSplit: '调整编辑区和预览区宽度',
      saved: '已保存',
      settings: '设置',
      showOutline: '展开大纲',
      split: '分屏',
      splitMode: '分屏模式',
      splitPreview: '分屏预览',
      splitPreviewDescription: '实时预览编辑区域文本（所见即所得）',
      table: '表格',
      tableColumns: '列数',
      tableRows: '行数',
      theme: '主题',
      themeSettings: '主题设置',
      addTags: '添加标签',
      categories: '分类目录',
      categoriesDescription: '选择文章归属的栏目。',
      categoriesSelected: '已选 %s 项',
      closePublish: '关闭发布弹窗',
      collapse: '收起',
      continueAddingTags: '继续添加...',
      excerpt: '摘要',
      excerptPlaceholder: '撰写摘要...',
      featuredImage: '特色图片',
      imageRecommendation: '建议使用横向图片',
      imageRequirements: '支持 JPG、PNG、WebP 格式，最大 5MB',
      noWriteBeforeSubmit: '提交前不会写入 WordPress。',
      openAfterPublish: '发布后打开文章页面',
      openAfterPublishDescription:
        '提交完成后跳转到文章页面，正文样式与当前预览一致。',
      openAfterUpdate: '更新后打开文章页面',
      password: '密码',
      passwordPlaceholder: '输入访问密码',
      passwordRequired: '请输入访问密码后再提交。',
      preparingPublish: '准备发布',
      private: '私密',
      privateDescription: '仅站点管理员和编辑可查看此文章。',
      public: '公开',
      publishDescription: '确认文章信息后，将发布到当前 WordPress 站点。',
      publishFailed: 'WordPress 未接受发布请求，请检查页面状态后重试。',
      publishLoadingPreview: '加载预览中...',
      publishOptions: '发布选项',
      remove: '移除',
      removeTag: '移除标签 %s',
      replace: '替换',
      selectFeaturedImage: '选择特色图片',
      sticky: '置于首页顶端',
      tags: '标签',
      tagsDescription: '输入后按 Enter 或逗号添加。',
      updateArticle: '更新文章',
      updateDescription: '确认本次修改后，将更新当前 WordPress 文章。',
      updateExisting: '更新已有文章',
      visibility: '可见性',
      title: '文章标题',
      unsaved: '未保存',
      viewModes: '视图模式',
      wechat: '复制到公众号',
      wechatCopied: '已复制'
    },
    immersiveEnvironment: {
      activeElement: () =>
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null,
      activateFavicon: vi.fn(() => vi.fn()),
      activateFocusBoundary: vi.fn(() => vi.fn()),
      hasOpenToolbarPopover: () => false,
      now: () => Date.now(),
      viewportWidth: () => window.innerWidth,
      schedule: (callback: () => void, delay: number) => {
        const timer = window.setTimeout(callback, delay);
        return () => window.clearTimeout(timer);
      },
      subscribeResize: (listener) => {
        resizeListener = listener;
        return () => {
          if (resizeListener === listener) resizeListener = null;
        };
      },
      observePreviewLayout: (_surface, listener) => {
        previewLayoutObservationCount += 1;
        previewLayoutListener = listener;
        return () => {
          if (previewLayoutListener === listener) previewLayoutListener = null;
        };
      },
      subscribeKeydown: (listener) => {
        document.addEventListener('keydown', listener);
        return () => document.removeEventListener('keydown', listener);
      }
    },
    immersiveI18n: {
      characters: (count) => `${count} 字符`,
      readingTime: (minutes) => `约 ${minutes} 分钟`,
      revisions: (count) => `共 ${count} 条历史版本`,
      words: (count) => `${count} 词`
    },
    immersivePreferencesPort: {
      read: vi.fn(() => ({ status: 'missing' as const })),
      write: vi.fn(() => ({ status: 'saved' as const }))
    },
    labels: {
      preview: 'Preview',
      source: 'Markdown',
      toolbar: 'Markdown toolbar'
    },
    imageUpload: {
      allowedExtensions: ['webp', 'png', 'jpg', 'jpeg', 'jfif', 'gif'],
      allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
      autoUploadPastedImages: true,
      enabled: true,
      insertion: { titleDisplay: 'none' },
      maxBytes: 1024,
      postId: 7,
      remoteImageUploadMode: 'both',
      strings: {
        defaultAlt: 'image',
        dropFailed: 'Drop failed',
        dropTooLarge: 'Drop too large',
        dropUploaded: 'Drop uploaded',
        dropUploading: 'Drop uploading',
        pasteAlreadyHosted: 'Paste already hosted',
        pasteChecking: 'Paste checking',
        pasteFailed: 'Paste failed',
        pasteUploadDisabled: 'Paste upload disabled',
        pasteTooLarge: 'Paste too large',
        pasteUploaded: 'Paste uploaded',
        pasteUploading: 'Paste uploading'
      }
    },
    imageUploadPort: {
      upload: vi.fn().mockResolvedValue({
        alt: 'uploaded image',
        status: 'uploaded',
        title: '',
        url: 'https://example.test/upload.png'
      } satisfies ImageUploadResult)
    },
    remoteImageImportPort: {
      import: vi.fn().mockResolvedValue({
        alt: 'remote image',
        status: 'uploaded',
        title: '',
        url: 'https://example.test/imported.png'
      } satisfies ImageUploadResult)
    },
    isNewPost: false,
    layout: {
      direction: 'ltr',
      status: {
        lastEdited: 'Last edited by Editor on July 27, 2026 at 10:00',
        wordCount: 'Character count: %s'
      }
    },
    localDraftStorage,
    localDrafts: {
      enabled: true,
      locale: 'en_US',
      maxBytes: 1048576,
      postId: 7,
      savedFingerprint: 'hash:selected',
      schemaVersion: 1,
      siteKey: 'synthetic-site',
      strings: {
        available: 'A newer local draft is available.',
        conflict: 'A different local draft was saved in another tab.',
        discard: 'Discard draft',
        discardFailed: 'Discard failed',
        discarded: 'Draft discarded',
        readFailed: 'Draft read failed',
        restore: 'Restore draft',
        restored: 'Draft restored',
        saveFailed: 'Draft save failed',
        saved: 'Local draft saved'
      },
      timeZone: 'UTC',
      userId: 42
    },
    mediaPicker: {
      canUseMedia: true,
      defaultAlt: 'image',
      frameUrl: 'https://example.test/media-picker',
      insertMedia: 'Insert Media',
      insertion: { titleDisplay: 'none' },
      placeholderAlt: 'alt text'
    },
    mediaPickerFailureMessage: 'The media library could not be opened.',
    mediaPickerFrame: mediaFrame,
    nativeForm,
    nativePublishPort: {
      apply: vi.fn(),
      read: vi.fn(() => ({
        availableFields: {
          categories: true,
          excerpt: true,
          featuredImage: true,
          sticky: true,
          tags: true,
          visibility: true
        },
        categories: [],
        categoryIds: [],
        excerpt: '',
        featuredImage: null,
        openPreview: false,
        password: '',
        existing: true,
        sticky: false,
        tags: [],
        visibility: 'public' as const
      }))
    },
    nativeSubmissionPort: createWordPressNativeSubmissionPort(nativeForm),
    onDocumentOwnerChange: vi.fn(),
    onFailure: vi.fn(),
    platform: 'win',
    publishPost: vi.fn(() => true),
    prepareToolbarShortcuts: vi.fn(() => ({
      prepareBinding: vi.fn(() => shortcutBinding)
    })),
    preview: {
      features: {},
      html: '<p>Initial</p>' as SafePreviewHtml,
      messages: { empty: 'Empty', error: 'Failed', loading: 'Loading' },
      postId: 7,
      signature: 'initial'
    },
    previewPort: {
      render: vi.fn((request: PreviewRequest) =>
        Promise.resolve(
          createPreviewResponse(
            request,
            '<p>Rendered</p>' as SafePreviewHtml,
            {}
          )
        )
      )
    },
    revisionPort: {
      get: vi.fn().mockResolvedValue({
        author: 'Editor',
        dateLabel: 'Today',
        html: '<p>Revision</p>' as SafePreviewHtml,
        id: 12,
        restoreUrl: 'https://example.test/wp-admin/revision.php?revision=12'
      }),
      list: vi.fn().mockResolvedValue([
        {
          author: 'Editor',
          dateLabel: 'Today',
          id: 12,
          restoreUrl: 'https://example.test/wp-admin/revision.php?revision=12'
        }
      ])
    },
    restoreRevision: vi.fn(),
    scrollPort: {
      capture: () => ({ left: 0, ratio: 0, top: 0 }),
      restore: vi.fn()
    },
    scrollSyncBinding,
    scrollSyncPort: {
      prepareBinding: vi.fn(() => scrollSyncBinding)
    },
    sessionAutosave: () => {
      for (const listener of sessionAutosaveListeners) {
        if ('blocked' === listener()) return 'blocked';
      }
      return 'continue';
    },
    sessionEmit: (status) => {
      sessionSnapshot = { status };
      for (const listener of sessionListeners) listener();
    },
    getPreviewLayoutObservationCount: () => previewLayoutObservationCount,
    triggerResize: () => resizeListener?.(),
    triggerPreviewLayout: () => previewLayoutListener?.(),
    sessionPort,
    settings: {
      general: {
        applyEditorThemeToFrontend: true,
        showPublishedCodeCopyButton: true,
        autoSave: true,
        autoSaveInterval: '0.5',
        editingMode: 'live-preview',
        interfaceLanguage: 'en-US',
        openPreviewAfterPublish: true,
        publishVisibility: 'public',
        showLineNumbers: true,
        statusBarMode: 'detailed',
        summaryMode: 'auto-55',
        syncScroll: true
      },
      markdown: { wordWrap: true }
    },
    shortcutBinding,
    submissionField,
    titleField,
    toolbar: {
      commands: [
        {
          action: 'wrap',
          group: 'format',
          icon: 'editor-bold',
          id: 'bold',
          label: 'Bold',
          placeholder: 'bold text',
          prefix: '**',
          suffix: '**',
          surface: 'main'
        },
        {
          action: 'image',
          group: 'insert',
          icon: 'format-image',
          id: 'image',
          label: 'Image',
          surface: 'main'
        },
        {
          action: 'copyWechat',
          group: 'export',
          icon: 'clipboard',
          id: 'copywechat',
          label: 'Copy to WeChat',
          surface: 'main'
        }
      ],
      headingLabelFormat: 'Heading %s',
      headingLevelLabel: 'Heading level',
      headingsLabel: 'Headings',
      linkText: 'link text',
      shortcuts: { bold: { mac: 'Cmd+B', win: 'Ctrl+B' } },
      undoLabel: 'Undo'
    },
    wechatClipboard: {
      copy: vi
        .fn()
        .mockResolvedValue({ method: 'clipboard', status: 'copied' }),
      rememberPreviewWidth: vi.fn(),
      prepare: vi.fn().mockResolvedValue(undefined)
    },
    wechatExport: {
      enabled: true,
      pngConversionEnabled: false,
      wechatMathAtlasContentVersion: '0123456789abcdef',
      wechatMathAtlasUrl:
        'https://example.test/wp-content/plugins/easymde/assets/math/easymde-katex-glyph-atlas.json?contentversion=0123456789abcdef',
      strings: {
        failed: 'Copy failed',
        failedWithUploads: 'Copy failed after uploading images',
        success: 'Copied',
        unsupported: 'Clipboard unsupported'
      }
    }
  };
}

export function imageTransferEvent(type: 'drop' | 'paste', file: File): Event {
  const transfer = {
    dropEffect: 'move',
    files: [file],
    items: [{ getAsFile: () => file, kind: 'file', type: file.type }]
  };
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: 'paste' === type ? transfer : null
  });
  Object.defineProperty(event, 'dataTransfer', {
    value: 'drop' === type ? transfer : null
  });
  return event;
}

export function observedBlockIndex(
  source: string,
  options: Parameters<typeof createProfiledMarkdownBlockIndex>[1] = {
    referenceLabelCaseFoldProfile: 14
  }
) {
  return createProfiledMarkdownBlockIndex(source, options);
}

export function cleanupEditorRootTestHarness(): void {
  vi.restoreAllMocks();
  previewGeometrySurfaces.clear();
  previewGeometryPrototypeInstalled = false;
  for (const field of mountedFields.splice(0)) {
    field.remove();
  }
}
