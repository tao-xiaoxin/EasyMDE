import {
  createElement,
  useCallback as observedCallback
} from '@wordpress/element';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react';
import { EditorSelection } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import observedKatex from 'katex';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  PreviewFeatures,
  PreviewRequest,
  PreviewResponse,
  SafePreviewHtml
} from '../../contracts/ports/preview-request';
import { undoDepth } from '@codemirror/commands';
import type { ImageUploadResult } from '../../contracts/ports/image-upload-port';
import type { EditorClipboardPort } from '../../contracts/ports/editor-clipboard-port';
import type {
  EditorImagePixelsPort,
  EditorImagePixelsResult
} from '../../contracts/ports/editor-image-pixels-port';
import type {
  EditorMarkdownImageIndexData,
  EditorMarkdownBlockIndexData,
  EditorMarkdownBlockIndexPort
} from '../../contracts/ports/editor-block-index-port';
import type { RemoteImageImportResult } from '../../contracts/ports/remote-image-import-port';
import type { LocalDraftStoragePort } from '../../contracts/ports/local-drafts-port';
import type {
  RevisionPreview,
  RevisionSummary
} from '../../contracts/ports/revision-port';
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
import type { ImmersiveVisualEditorRuntime } from '../../features/immersive-editor/ui/ImmersiveVisualEditor';
import type { GeneratedContentExportSession } from '../../features/generated-content-export/generated-content-export-session';
import * as generatedImageTarget from '../../features/generated-content-export/generated-image-target';
import * as imageScaleContract from '../../features/image-scale/image-scale-contract';
import * as observedSourceAdapter from '../../features/document-source/adapters/code-mirror-document-session';
import {
  createEditorMarkdownBlockIndex as observedBlockIndex,
  findEditorCodeContentTarget as observedCodeContentTarget
} from '../../features/editor-context-menu/editor-markdown-block-index';
import * as observedPreviewOwner from '../../features/live-preview/ui/PreviewSurfaceOwner';
import { DEFAULT_PREVIEW_WINDOW_MAX_MOUNTED } from '../../features/live-preview/model/preview-window-model';
import {
  focusVisualPreviewRuntime,
  EditorRoot,
  isVisualPreviewWindowRequestCurrent,
  schedulePreviewWithDocumentEndPin,
  scheduleVisualWindowedHistoryBranchRelease,
  visualPreviewSourceHasEditableMap,
  visualPreviewUsesWindowedOwner,
  visualPreviewSurfaceUsesWindowedOwner,
  visualPreviewSurfaceWindowedForVisibility,
  type EditorRootProps
} from './EditorRoot';
import { EditorRootErrorBoundary } from './EditorRootErrorBoundary';

const mountedFields: Array<HTMLElement> = [];
const previewGeometrySurfaces = new Set<HTMLElement>();
let previewGeometryPrototypeInstalled = false;

const contextMenuStrings = {
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, reject, resolve };
}

function layoutContextMenuSurface(
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

function layoutPreviewSurface(container: HTMLElement): void {
  const surface = container.querySelector<HTMLElement>(
    '[data-easymde-preview-html-sink="1"]'
  );
  if (!surface) throw new Error('preview-surface-missing');
  layoutContextMenuSurface(surface, { keepLivePreviewGeometry: true });
}

type QueuedAnimationFrames = {
  callbacks: Map<number, FrameRequestCallback>;
  restore: () => void;
};

function createQueuedAnimationFrames(): QueuedAnimationFrames {
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

async function drainAnimationFrameBatch(
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

async function drainAnimationFrames(
  frameQueue: QueuedAnimationFrames,
  maxFrames = 24
): Promise<void> {
  for (let index = 0; index < maxFrames; index += 1) {
    if (!(await drainAnimationFrameBatch(frameQueue, index))) return;
  }
  if (frameQueue.callbacks.size > 0) {
    throw new Error('animation-frame-bound-exceeded');
  }
}

async function drainAnimationFramesUntil(
  frameQueue: QueuedAnimationFrames,
  ready: () => boolean,
  maxFrames = 24
): Promise<void> {
  for (let index = 0; index < maxFrames; index += 1) {
    if (ready()) return;
    if (!(await drainAnimationFrameBatch(frameQueue, index))) {
      await act(async () => {
        await Promise.resolve();
      });
    }
  }
  if (!ready()) throw new Error('animation-frame-readiness-bound-exceeded');
}

function createPreviewResponse(
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

function createCodeContentPreviewResponse(
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

function createCodeIndentationPreviewResponse(
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

function createSourceLinkPreviewResponse(
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

function sourceLinkParser(): NonNullable<EditorRootProps['simplifiedFormattingParser']> {
  return {
    parseFromString: (source, mimeType) =>
      new DOMParser().parseFromString(source, mimeType)
  };
}

function sourceLinkBlockIndexPort(): EditorMarkdownBlockIndexPort {
  return {
    build: vi.fn(async ({ source }) => observedBlockIndex(source)),
    dispose: vi.fn()
  };
}

function imageBlockIndexData(
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

function imageBlockIndexPort(): EditorMarkdownBlockIndexPort {
  return {
    build: vi.fn(async ({ source }) => imageBlockIndexData(source)),
    dispose: vi.fn()
  };
}

function BrokenEditorRoot(): never {
  throw new Error('synthetic editor-root render failure');
}

function fixture(): EditorRootProps &
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
    enhancementPort: {
      dispose: vi.fn(),
      enhance: vi.fn().mockResolvedValue(undefined),
      prepareCodeTheme: vi.fn().mockResolvedValue({
        cancel: vi.fn(),
        commit: vi.fn()
      }),
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
      prepare: vi.fn().mockResolvedValue(undefined)
    },
    wechatExport: {
      enabled: true,
      pngConversionEnabled: false,
      strings: {
        failed: 'Copy failed',
        success: 'Copied',
        unsupported: 'Clipboard unsupported'
      }
    }
  };
}

function imageTransferEvent(type: 'drop' | 'paste', file: File): Event {
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

afterEach(() => {
  vi.restoreAllMocks();
  previewGeometrySurfaces.clear();
  previewGeometryPrototypeInstalled = false;
  for (const field of mountedFields.splice(0)) {
    field.remove();
  }
});

type MixedGeneratedNativeRange =
  | 'enclosing'
  | 'foreign'
  | 'inside'
  | 'straddling';

async function renderMixedGeneratedVisual(
  windowed: boolean,
  nativeRange: MixedGeneratedNativeRange = 'inside'
) {
  const props = fixture();
  const sourceMarkdown = windowed
    ? [
        'Before',
        '$x$',
        'After',
        ...Array.from({ length: 158 }, (_, index) => `suffix ${index}`)
      ].join('\n')
    : 'Before\n$x$\nAfter';
  const mathStart = sourceMarkdown.indexOf('$x$');
  props.submissionField.value = sourceMarkdown;
  props.submissionField.defaultValue = sourceMarkdown;
  props.submissionField.setSelectionRange(0, 0);
  const rendered = windowed
    ? [
        '<p>Before</p>',
        '<p><span class="easymde-math easymde-math-inline"><span class="katex"><span class="katex-mathml"><math><mi>x</mi></math></span></span></span></p>',
        '<p>After</p>',
        ...Array.from(
          { length: 158 },
          (_, index) => `<p>suffix ${index}</p>`
        )
      ].join('')
    : '<p>Before</p><p><span class="easymde-math easymde-math-inline"><span class="katex"><span class="katex-mathml"><math><mi>x</mi></math></span></span></span></p><p>After</p>';
  vi.mocked(props.previewPort.render).mockImplementation((request) =>
    Promise.resolve(
      createPreviewResponse(request, rendered as SafePreviewHtml, { math: true })
    )
  );
  const editorBlockIndexPort: EditorMarkdownBlockIndexPort = {
    build: vi.fn(async ({ source }) => ({
      ...imageBlockIndexData(source),
      mathSpans: [
        {
          bodyFrom: mathStart + 1,
          bodyTo: mathStart + 2,
          displayMode: false,
          from: mathStart,
          to: mathStart + 3
        }
      ]
    })),
    dispose: vi.fn()
  };
  const generatedContentExportSession = {
    copyAsImage: vi.fn().mockResolvedValue({ status: 'copied' }),
    copyMathMl: vi.fn().mockResolvedValue({ status: 'copied' }),
    dispose: vi.fn(),
  } as GeneratedContentExportSession;
  const view = render(
    <EditorRoot
      {...props}
      editorBlockIndexPort={editorBlockIndexPort}
      generatedContentExportSession={generatedContentExportSession}
    />
  );
  fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
  fireEvent.click(view.getByRole('button', { name: '预览' }));
  await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
  layoutPreviewSurface(view.container);
  fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
  const visual = await view.findByRole('textbox', {
    name: '可视化文章编辑器'
  });
  const math = visual.querySelector<HTMLElement>('.easymde-math');
  const paragraphs = visual.querySelectorAll('p');
  const beforeText = paragraphs[0]?.firstChild;
  const afterText = paragraphs[2]?.firstChild;
  if (!math || !(beforeText instanceof Text) || !(afterText instanceof Text)) {
    throw new Error('mixed-generated-selection-target-missing');
  }
  const range = document.createRange();
  let cleanupNativeRange = (): void => undefined;
  if ('inside' === nativeRange) {
    range.setStart(beforeText, 1);
    range.setEnd(afterText, 3);
  } else if ('foreign' === nativeRange) {
    const external = document.createElement('p');
    external.textContent = 'synthetic external selection';
    document.body.append(external);
    const externalText = external.firstChild;
    if (!(externalText instanceof Text)) {
      throw new Error('mixed-generated-foreign-selection-missing');
    }
    range.setStart(externalText, 0);
    range.setEnd(externalText, 9);
    cleanupNativeRange = () => external.remove();
  } else if ('straddling' === nativeRange) {
    const external = document.createElement('p');
    external.textContent = 'synthetic external selection';
    document.body.append(external);
    const externalText = external.firstChild;
    if (!(externalText instanceof Text)) {
      throw new Error('mixed-generated-straddling-selection-missing');
    }
    range.setStart(beforeText, 1);
    range.setEnd(externalText, 9);
    cleanupNativeRange = () => external.remove();
  } else {
    const parent = visual.parentElement;
    if (!parent) throw new Error('mixed-generated-enclosing-parent-missing');
    const externalBefore = document.createElement('p');
    const externalAfter = document.createElement('p');
    externalBefore.textContent = 'synthetic selection before';
    externalAfter.textContent = 'synthetic selection after';
    parent.insertBefore(externalBefore, visual);
    parent.insertBefore(externalAfter, visual.nextSibling);
    const externalBeforeText = externalBefore.firstChild;
    const externalAfterText = externalAfter.firstChild;
    if (
      !(externalBeforeText instanceof Text)
      || !(externalAfterText instanceof Text)
    ) {
      throw new Error('mixed-generated-enclosing-selection-missing');
    }
    range.setStart(externalBeforeText, 0);
    range.setEnd(externalAfterText, 9);
    cleanupNativeRange = () => {
      externalBefore.remove();
      externalAfter.remove();
    };
  }
  const nativeSelection = window.getSelection();
  nativeSelection?.removeAllRanges();
  nativeSelection?.addRange(range);
  layoutContextMenuSurface(visual);
  fireEvent.contextMenu(math, { clientX: 24, clientY: 30 });
  return { cleanupNativeRange, math, props, sourceMarkdown, view, visual };
}

describe('EditorRoot', () => {
  it.each([false, true] as const)(
    'uses the real native mixed selection for %s generated visual context',
    async (windowed) => {
      const { props, sourceMarkdown, view } =
        await renderMixedGeneratedVisual(windowed);
      const copyAs = await within(document.body).findByRole('menuitem', {
        name: 'Copy / Paste as'
      });
      expect(within(document.body).queryByRole('menuitem', {
        name: 'Formula'
      })).toBeNull();
      fireEvent.click(copyAs);
      const copyMarkdown = await within(document.body).findByRole('menuitem', {
        name: 'Copy as Markdown'
      });
      expect(copyMarkdown.getAttribute('aria-disabled')).toBe('false');
      fireEvent.click(copyMarkdown);
      await waitFor(() => expect(props.editorClipboardPort?.write).toHaveBeenCalledWith(
        'efore\n$x$\nAft'
      ));
      expect(props.submissionField.value).toBe(sourceMarkdown);
      expect(props.onFailure).not.toHaveBeenCalled();
      view.unmount();
    }
  );

  it.each([
    [false, 'foreign'],
    [false, 'straddling'],
    [false, 'enclosing'],
    [true, 'foreign'],
    [true, 'straddling'],
    [true, 'enclosing']
  ] as const)(
    'routes a %s %s native range by visual owner before generated actions',
    async (windowed, nativeRange) => {
      const { cleanupNativeRange, props, sourceMarkdown, view } =
        await renderMixedGeneratedVisual(windowed, nativeRange);
      try {
        if ('foreign' === nativeRange) {
          expect(
            await within(document.body).findByRole('menuitem', {
              name: 'Formula'
            })
          ).toBeTruthy();
          expect(props.onFailure).not.toHaveBeenCalled();
        } else {
          await waitFor(() => expect(props.onFailure).toHaveBeenCalled());
          const failure = vi.mocked(props.onFailure);
          expect(
            failure.mock.calls.some(([code]) =>
              String(code).includes('selection-map-failed')
            )
          ).toBe(true);
          expect(within(document.body).queryByRole('menu')).toBeNull();
        }
        expect(props.submissionField.value).toBe(sourceMarkdown);
      } finally {
        cleanupNativeRange();
        view.unmount();
      }
    }
  );

  it('does not deliver a queued frame canceled by an earlier callback', async () => {
    const frameQueue = createQueuedAnimationFrames();
    const delivered: string[] = [];
    let secondId = 0;
    try {
      window.requestAnimationFrame(() => {
        delivered.push('first');
        window.cancelAnimationFrame(secondId);
      });
      secondId = window.requestAnimationFrame(() => delivered.push('second'));
      await drainAnimationFrameBatch(frameQueue, 0);
      expect(delivered).toEqual(['first']);
      expect(frameQueue.callbacks.size).toBe(0);
    } finally {
      frameQueue.restore();
    }
  });

  it.each(['Ctrl+Shift+I', 'Ctrl+Alt+I', ''])(
    'projects the current image shortcut into the insertion menu (%s)',
    async (binding) => {
      const props = fixture();
      const view = render(
        <EditorRoot
          {...props}
          toolbar={{
            ...props.toolbar,
            commands: props.toolbar.commands.map((command) =>
              'image' === command.id
                ? {
                    ...command,
                    defaultShortcutMac: 'Cmd+I',
                    defaultShortcutWin: 'Ctrl+I'
                  }
                : command
            ),
            shortcuts: {
              ...props.toolbar.shortcuts,
              image: { mac: 'Cmd+Shift+I', win: binding }
            }
          }}
        />
      );
      const source = await waitFor(() => {
        const element =
          view.container.querySelector<HTMLElement>('.cm-content');
        if (!element) throw new Error('source-surface-missing');
        return element;
      });
      layoutContextMenuSurface(source);
      fireEvent.contextMenu(source, { clientX: 20, clientY: 24 });
      fireEvent.click(
        await within(document.body).findByRole('menuitem', { name: 'Insert' })
      );
      const image = await within(document.body).findByRole('menuitem', {
        name: /^Insert image above/
      });
      const hint = image.querySelector(
        '.easymde-editor-context-menu__shortcut'
      );
      expect(hint?.textContent ?? '').toBe(binding);
      expect(props.submissionField.value).toBe('selected');
      view.unmount();
    }
  );

  it('mounts the shared context menu through the canonical Source session', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);
    const source = await waitFor(() => {
      const element = view.container.querySelector<HTMLElement>('.cm-content');
      if (!element) throw new Error('source-surface-missing');
      return element;
    });

    layoutContextMenuSurface(source);
    fireEvent.contextMenu(source, { clientX: 20, clientY: 24 });
    const sourceMenu = await within(document.body).findByRole('menu');
    expect(sourceMenu).toBeTruthy();
    expect(
      sourceMenu.closest<HTMLElement>('[data-easymde-context-menu="true"]')
        ?.style.clipPath
    ).toBe('');
    expect(
      within(document.body).getByRole('menuitem', { name: /^Bold/ })
    ).toBeTruthy();
    const shortcutOwner = vi
      .mocked(props.prepareToolbarShortcuts)
      .mock.calls.slice(-1)[0]?.[0]?.isOwnedTarget;
    if (!shortcutOwner) throw new Error('context-menu-shortcut-owner-missing');
    expect(
      shortcutOwner(
        within(document.body).getByRole('menuitem', { name: 'Copy' })
      )
    ).toBe(true);
    expect(shortcutOwner(document.createElement('button'))).toBe(false);
    fireEvent.click(
      within(document.body).getByRole('menuitem', { name: 'Copy' })
    );
    await waitFor(() =>
      expect(props.editorClipboardPort?.write).toHaveBeenCalledWith('selected')
    );
    expect(props.submissionField.value).toBe('selected');
    view.unmount();
  });

  it('opens the heading-level submenu for a Source heading and marks its current level', async () => {
    const props = fixture();
    const sourceValue = '## Heading two\n\nBody';
    const headingPosition = sourceValue.indexOf('Heading');
    props.submissionField.value = sourceValue;
    props.submissionField.defaultValue = sourceValue;
    props.submissionField.setSelectionRange(headingPosition, headingPosition);
    const headingLevels = [1, 2, 3, 4, 5, 6] as const;
    const view = render(
      <EditorRoot
        {...props}
        toolbar={{
          ...props.toolbar,
          commands: [
            ...props.toolbar.commands,
            ...headingLevels.map((level) => ({
              action: 'heading' as const,
              group: 'heading',
              icon: 'heading',
              id: `heading${level}`,
              label: `Heading ${level}`,
              level,
              surface: 'heading-menu' as const
            }))
          ]
        }}
      />
    );
    const source = await waitFor(() => {
      const element = view.container.querySelector<HTMLElement>('.cm-content');
      if (!element) throw new Error('source-surface-missing');
      return element;
    });

    layoutContextMenuSurface(source);
    fireEvent.contextMenu(source, { clientX: 20, clientY: 24 });
    const headingLevel = await within(document.body).findByRole('menuitem', {
      name: 'Heading level'
    });
    fireEvent.mouseEnter(headingLevel);
    const currentLevel = await within(document.body).findByRole('menuitem', {
      name: 'Heading 2'
    });
    expect(
      currentLevel.getAttribute('data-easymde-context-menu-checked')
    ).toBe('true');
    expect(
      within(document.body)
        .getByRole('menuitem', { name: 'Heading 3' })
        .getAttribute('data-easymde-context-menu-checked')
    ).toBeNull();

    fireEvent.click(
      within(document.body).getByRole('menuitem', { name: 'Heading 3' })
    );
    await waitFor(() =>
      expect(props.submissionField.value).toBe('### Heading two\n\nBody')
    );
    expect(EditorView.findFromDOM(source)?.state.doc.toString()).toBe(
      '### Heading two\n\nBody'
    );
    fireEvent.click(view.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(props.submissionField.value).toBe(sourceValue));
    view.unmount();
  });

  it('opens the pointed Source context from a bare right-click instead of the previous caret', async () => {
    const props = fixture();
    const sourceValue = '## Heading two\n\nBody';
    props.submissionField.value = sourceValue;
    props.submissionField.defaultValue = sourceValue;
    // The collapsed caret is deliberately left in a different block: only the
    // pointer gesture may decide the captured context.
    props.submissionField.setSelectionRange(sourceValue.length, sourceValue.length);
    const headingLevels = [1, 2, 3, 4, 5, 6] as const;
    const view = render(
      <EditorRoot
        {...props}
        toolbar={{
          ...props.toolbar,
          commands: [
            ...props.toolbar.commands,
            ...headingLevels.map((level) => ({
              action: 'heading' as const,
              group: 'heading',
              icon: 'heading',
              id: `heading${level}`,
              label: `Heading ${level}`,
              level,
              surface: 'heading-menu' as const
            }))
          ]
        }}
      />
    );
    const source = await waitFor(() => {
      const element = view.container.querySelector<HTMLElement>('.cm-content');
      if (!element) throw new Error('source-surface-missing');
      return element;
    });
    const editorView = EditorView.findFromDOM(source);
    if (!editorView) throw new Error('source-editor-view-missing');
    layoutContextMenuSurface(source);
    const pointer = { x: 1, y: 0 };
    const mapped = editorView.posAtCoords(pointer, false);
    if (null === mapped) throw new Error('source-pointer-unmappable');
    const headingLine = editorView.state.doc.line(1);
    expect(mapped).toBeGreaterThanOrEqual(headingLine.from);
    expect(mapped).toBeLessThanOrEqual(headingLine.to);
    expect(mapped).toBeLessThan(sourceValue.length);

    // A real right-click: the pointer gesture precedes the native context-menu
    // request, exactly as the browser dispatches it.
    fireEvent.mouseDown(source, { button: 2, clientX: pointer.x, clientY: pointer.y });
    fireEvent.contextMenu(source, { clientX: pointer.x, clientY: pointer.y });

    const headingLevel = await within(document.body).findByRole('menuitem', {
      name: 'Heading level'
    });
    fireEvent.mouseEnter(headingLevel);
    expect(
      (
        await within(document.body).findByRole('menuitem', { name: 'Heading 2' })
      ).getAttribute('data-easymde-context-menu-checked')
    ).toBe('true');
    // The canonical selection was established from the pointer before the
    // demand snapshot was captured.
    expect(editorView.state.selection.main.head).toBe(mapped);
    view.unmount();
  });

  it('opens a certified formula context from the canonical Source session', async () => {
    const props = fixture();
    const sourceMarkdown = 'Before\n$x$\nAfter';
    const mathStart = sourceMarkdown.indexOf('$x$');
    const blocks = [
      {
        editable: true as const,
        from: 0,
        kind: 'paragraph' as const,
        lineEnd: 0,
        lineStart: 0,
        to: 6
      },
      {
        editable: true as const,
        from: 7,
        kind: 'paragraph' as const,
        lineEnd: 1,
        lineStart: 1,
        to: 10
      },
      {
        editable: true as const,
        from: 11,
        kind: 'paragraph' as const,
        lineEnd: 2,
        lineStart: 2,
        to: sourceMarkdown.length
      }
    ];
    props.submissionField.value = sourceMarkdown;
    props.submissionField.defaultValue = sourceMarkdown;
    props.submissionField.setSelectionRange(mathStart, mathStart + 3);
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      Promise.resolve(
        createPreviewResponse(
          request,
          '<p>Before</p><p><span class="easymde-math easymde-math-inline"><span class="katex"><span class="katex-mathml"><math><mi>x</mi></math></span></span></span></p><p>After</p>' as SafePreviewHtml,
          { math: true }
        )
      )
    );
    const editorBlockIndexPort: EditorMarkdownBlockIndexPort = {
      build: vi.fn(async () => ({
        blocks,
        imageBlocks: blocks.map(() => ({
          count: 0,
          firstImageIndex: 0,
          status: 'ready' as const
        })),
        imageRanges: [],
        length: sourceMarkdown.length,
        mathSpans: [
          {
            bodyFrom: mathStart + 1,
            bodyTo: mathStart + 2,
            displayMode: false,
            from: mathStart,
            to: mathStart + 3
          }
        ]
      })),
      dispose: vi.fn()
    };
    const generatedContentExportSession = {
      copyAsImage: vi.fn().mockResolvedValue({ status: 'copied' }),
      copyMathMl: vi.fn().mockResolvedValue({ status: 'copied' }),
      dispose: vi.fn(),
    } as GeneratedContentExportSession;
    const view = render(
      <EditorRoot
        {...props}
        editorBlockIndexPort={editorBlockIndexPort}
        generatedContentExportSession={generatedContentExportSession}
      />
    );
    const source = await waitFor(() => {
      const element = view.container.querySelector<HTMLElement>('.cm-content');
      if (!element) throw new Error('source-surface-missing');
      return element;
    });
    await waitFor(() =>
      expect(view.container.querySelector('.easymde-math')).not.toBeNull()
    );
    layoutContextMenuSurface(source);
    fireEvent.contextMenu(source, { clientX: 20, clientY: 24 });
    await waitFor(() =>
      expect(editorBlockIndexPort.build).toHaveBeenCalledOnce()
    );
    const formula = await within(document.body).findByRole('menuitem', {
      name: 'Formula'
    });
    fireEvent.mouseEnter(formula);
    await waitFor(() =>
      expect(formula.getAttribute('aria-expanded')).toBe('true')
    );
    const copySubmenu = within(document.body)
      .getAllByRole('menuitem', { name: 'Copy' })
      .find((item) => item.getAttribute('aria-haspopup') === 'menu');
    if (!copySubmenu) throw new Error('generated-copy-submenu-missing');
    fireEvent.mouseEnter(copySubmenu);
    await waitFor(() =>
      expect(copySubmenu.getAttribute('aria-expanded')).toBe('true')
    );
    expect(
      await within(document.body).findByRole('menuitem', {
        name: 'Copy MathML'
      })
    ).toBeTruthy();
    expect(within(document.body).queryByRole('menuitem', {
      name: 'Code block'
    })).toBeNull();
    fireEvent.mouseEnter(copySubmenu);
    const copyMathSource = await within(document.body).findByRole('menuitem', {
      name: 'Copy TeX'
    });
    fireEvent.click(copyMathSource);
    await waitFor(() =>
      expect(props.editorClipboardPort?.write).toHaveBeenCalledWith('x')
    );
    expect(props.submissionField.value).toBe(sourceMarkdown);
    view.unmount();
  });

  it('fails and releases a generated Source target after the injected readiness deadline', async () => {
    const props = fixture();
    const sourceMarkdown = 'Before\n$x$\nAfter';
    const mathStart = sourceMarkdown.indexOf('$x$');
    const blocks = [
      {
        editable: true as const,
        from: 0,
        kind: 'paragraph' as const,
        lineEnd: 0,
        lineStart: 0,
        to: 6
      },
      {
        editable: true as const,
        from: 7,
        kind: 'paragraph' as const,
        lineEnd: 1,
        lineStart: 1,
        to: 10
      },
      {
        editable: true as const,
        from: 11,
        kind: 'paragraph' as const,
        lineEnd: 2,
        lineStart: 2,
        to: sourceMarkdown.length
      }
    ];
    props.submissionField.value = sourceMarkdown;
    props.submissionField.defaultValue = sourceMarkdown;
    props.submissionField.setSelectionRange(mathStart, mathStart + 3);
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      Promise.resolve(
        createPreviewResponse(
          request,
          '<p>Before</p><p>Plain</p><p>After</p>' as SafePreviewHtml,
          {
            math: true
          }
        )
      )
    );
    const editorBlockIndexPort: EditorMarkdownBlockIndexPort = {
      build: vi.fn(async () => ({
        blocks,
        imageBlocks: blocks.map(() => ({
          count: 0,
          firstImageIndex: 0,
          status: 'ready' as const
        })),
        imageRanges: [],
        length: sourceMarkdown.length,
        mathSpans: [
          {
            bodyFrom: mathStart + 1,
            bodyTo: mathStart + 2,
            displayMode: false,
            from: mathStart,
            to: mathStart + 3
          }
        ]
      })),
      dispose: vi.fn()
    };
    const generatedContentExportSession = {
      copyAsImage: vi.fn().mockResolvedValue({ status: 'copied' }),
      copyMathMl: vi.fn().mockResolvedValue({ status: 'copied' }),
      dispose: vi.fn(),
    } as GeneratedContentExportSession;
    let now = 0;
    const scheduled: Array<{
      callback: () => void;
      cancelled: boolean;
      delay: number;
      fired: boolean;
    }> = [];
    const immersiveEnvironment = {
      ...props.immersiveEnvironment,
      now: () => now,
      schedule: (callback: () => void, delay: number) => {
        const task = { callback, cancelled: false, delay, fired: false };
        scheduled.push(task);
        return () => {
          task.cancelled = true;
        };
      }
    };
    const view = render(
      <EditorRoot
        {...props}
        editorBlockIndexPort={editorBlockIndexPort}
        generatedContentExportSession={generatedContentExportSession}
        immersiveEnvironment={immersiveEnvironment}
      />
    );
    const source = await waitFor(() => {
      const element = view.container.querySelector<HTMLElement>('.cm-content');
      if (!element) throw new Error('source-surface-missing');
      return element;
    });
    await waitFor(() =>
      expect(
        view.container.querySelector('[data-easymde-preview-html-sink="1"]')
      ).not.toBeNull()
    );
    layoutContextMenuSurface(source);
    fireEvent.contextMenu(source, { clientX: 20, clientY: 24 });
    await waitFor(() =>
      expect(editorBlockIndexPort.build).toHaveBeenCalledOnce()
    );
    await waitFor(() =>
      expect(scheduled.some(({ delay }) => 10_000 === delay)).toBe(true)
    );
    const deadline = scheduled.find(
      ({ delay, cancelled }) => 10_000 === delay && !cancelled
    );
    if (!deadline) throw new Error('generated-readiness-deadline-missing');
    now = 10_000;
    act(() => {
      deadline.fired = true;
      deadline.callback();
    });
    await waitFor(() =>
      expect(props.onFailure).toHaveBeenCalledWith(
        'editor-context-menu-generated-content-unavailable'
      )
    );
    const clipboardCheck = props.editorClipboardPort?.check;
    if (!clipboardCheck) throw new Error('clipboard-check-missing');
    expect(vi.mocked(clipboardCheck).mock.calls[0]?.[0]?.signal?.aborted).toBe(
      true
    );
    expect(view.queryByRole('menu')).toBeNull();
    expect(
      scheduled.filter(
        ({ delay, cancelled, fired }) =>
          10_000 === delay && !cancelled && !fired
      )
    ).toHaveLength(0);
    fireEvent.contextMenu(source, { clientX: 20, clientY: 24 });
    await waitFor(() => expect(props.onFailure).toHaveBeenCalledTimes(2));
    expect(scheduled.filter(({ delay }) => 10_000 === delay)).toHaveLength(1);
    view.unmount();
  });

  it('cancels a pending generated target deadline when the Root tears down', async () => {
    const props = fixture();
    const sourceMarkdown = 'Before\n$x$\nAfter';
    const mathStart = sourceMarkdown.indexOf('$x$');
    props.submissionField.value = sourceMarkdown;
    props.submissionField.defaultValue = sourceMarkdown;
    props.submissionField.setSelectionRange(mathStart, mathStart + 3);
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      Promise.resolve(
        createPreviewResponse(
          request,
          '<p>Before</p><p>Plain</p><p>After</p>' as SafePreviewHtml,
          {
            math: true
          }
        )
      )
    );
    const editorBlockIndexPort: EditorMarkdownBlockIndexPort = {
      build: vi.fn(async () => ({
        blocks: [
          {
            editable: true as const,
            from: 0,
            kind: 'paragraph' as const,
            lineEnd: 2,
            lineStart: 0,
            to: sourceMarkdown.length
          }
        ],
        imageBlocks: [
          { count: 0, firstImageIndex: 0, status: 'ready' as const }
        ],
        imageRanges: [],
        length: sourceMarkdown.length,
        mathSpans: [
          {
            bodyFrom: mathStart + 1,
            bodyTo: mathStart + 2,
            displayMode: false,
            from: mathStart,
            to: mathStart + 3
          }
        ]
      })),
      dispose: vi.fn()
    };
    const scheduled: Array<{ cancelled: boolean; delay: number }> = [];
    const immersiveEnvironment = {
      ...props.immersiveEnvironment,
      now: () => 0,
      schedule: (_callback: () => void, delay: number) => {
        const task = { cancelled: false, delay };
        scheduled.push(task);
        return () => {
          task.cancelled = true;
        };
      }
    };
    const view = render(
      <EditorRoot
        {...props}
        editorBlockIndexPort={editorBlockIndexPort}
        generatedContentExportSession={
          {
            copyAsImage: vi.fn(),
            copyMathMl: vi.fn(),
            dispose: vi.fn(),
          } as unknown as GeneratedContentExportSession
        }
        immersiveEnvironment={immersiveEnvironment}
      />
    );
    const source = await waitFor(() => {
      const element = view.container.querySelector<HTMLElement>('.cm-content');
      if (!element) throw new Error('source-surface-missing');
      return element;
    });
    layoutContextMenuSurface(source);
    fireEvent.contextMenu(source, { clientX: 20, clientY: 24 });
    await waitFor(() =>
      expect(scheduled.some(({ delay }) => 10_000 === delay)).toBe(true)
    );
    view.unmount();
    expect(
      scheduled
        .filter(({ delay }) => 10_000 === delay)
        .every(({ cancelled }) => cancelled)
    ).toBe(true);
  });

  it('keeps a pending Source Copy-as-image lease alive when a reopened menu is dismissed', async () => {
    const props = fixture();
    const sourceMarkdown = 'Before\n$x$\nAfter';
    const mathStart = sourceMarkdown.indexOf('$x$');
    const blocks = [
      {
        editable: true as const,
        from: 0,
        kind: 'paragraph' as const,
        lineEnd: 0,
        lineStart: 0,
        to: 6
      },
      {
        editable: true as const,
        from: 7,
        kind: 'paragraph' as const,
        lineEnd: 1,
        lineStart: 1,
        to: 10
      },
      {
        editable: true as const,
        from: 11,
        kind: 'paragraph' as const,
        lineEnd: 2,
        lineStart: 2,
        to: sourceMarkdown.length
      }
    ];
    props.submissionField.value = sourceMarkdown;
    props.submissionField.defaultValue = sourceMarkdown;
    props.submissionField.setSelectionRange(mathStart, mathStart + 3);
    const editorClipboardPort = {
      ...props.editorClipboardPort,
      supportsPngWrite: vi.fn(() => true),
      writeImageDeferred: vi.fn(async () => ({ status: 'written' as const }))
    } as EditorClipboardPort;
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      Promise.resolve(
        createPreviewResponse(
          request,
          '<p>Before</p><p><span class="easymde-math easymde-math-inline"><span class="katex"><span class="katex-mathml"><math><mi>x</mi></math></span></span></span></p><p>After</p>' as SafePreviewHtml,
          { math: true }
        )
      )
    );
    const editorBlockIndexPort: EditorMarkdownBlockIndexPort = {
      build: vi.fn(async () => ({
        blocks,
        imageBlocks: blocks.map(() => ({
          count: 0,
          firstImageIndex: 0,
          status: 'ready' as const
        })),
        imageRanges: [],
        length: sourceMarkdown.length,
        mathSpans: [
          {
            bodyFrom: mathStart + 1,
            bodyTo: mathStart + 2,
            displayMode: false,
            from: mathStart,
            to: mathStart + 3
          }
        ]
      })),
      dispose: vi.fn()
    };
    const pendingCopy = deferred<void>();
    let leaseWasCurrentAfterResolve = false;
    const generatedContentExportSession = {
      copyAsImage: vi.fn(
        async (
          request: Parameters<GeneratedContentExportSession['copyAsImage']>[0]
        ) => {
          await pendingCopy.promise;
          const lease = request.lease as typeof request.lease & {
            isCurrent?: () => boolean;
          };
          leaseWasCurrentAfterResolve = lease.isCurrent?.() === true;
          return leaseWasCurrentAfterResolve
            ? { status: 'copied' as const }
            : {
                code: 'generated-content-export-lease-stale' as const,
                status: 'failed' as const
              };
        }
      ),
      copyMathMl: vi.fn().mockResolvedValue({ status: 'copied' as const }),
      dispose: vi.fn(),
    } as GeneratedContentExportSession;
    const view = render(
      <EditorRoot
        {...props}
        editorBlockIndexPort={editorBlockIndexPort}
        editorClipboardPort={editorClipboardPort}
        generatedContentExportSession={generatedContentExportSession}
      />
    );
    const source = await waitFor(() => {
      const element = view.container.querySelector<HTMLElement>('.cm-content');
      if (!element) throw new Error('source-surface-missing');
      return element;
    });
    await waitFor(() =>
      expect(view.container.querySelector('.easymde-math')).not.toBeNull()
    );
    layoutContextMenuSurface(source);
    const openGeneratedCopyImage = async (): Promise<void> => {
      const formula = await within(document.body).findByRole('menuitem', {
        name: 'Formula'
      });
      fireEvent.mouseEnter(formula);
      const copySubmenu = within(document.body)
        .getAllByRole('menuitem', { name: 'Copy' })
        .find((item) => item.getAttribute('aria-haspopup') === 'menu');
      if (!copySubmenu) throw new Error('generated-copy-submenu-missing');
      fireEvent.mouseEnter(copySubmenu);
      const copyImage = await within(document.body).findByRole('menuitem', {
        name: 'Copy as image'
      });
      fireEvent.click(copyImage);
    };
    fireEvent.contextMenu(source, { clientX: 20, clientY: 24 });
    await waitFor(() =>
      expect(editorBlockIndexPort.build).toHaveBeenCalledOnce()
    );
    await openGeneratedCopyImage();
    await waitFor(() =>
      expect(generatedContentExportSession.copyAsImage).toHaveBeenCalledOnce()
    );

    fireEvent.contextMenu(source, { clientX: 24, clientY: 28 });
    await within(document.body).findByRole('menu');
    fireEvent.contextMenu(document.body);
    pendingCopy.resolve();
    await waitFor(() => expect(leaseWasCurrentAfterResolve).toBe(true));
    expect(props.onFailure).not.toHaveBeenCalledWith(
      'generated-content-export-lease-stale'
    );
    expect(props.submissionField.value).toBe(sourceMarkdown);
    view.unmount();
  });

  it('deletes only the captured Markdown image range and keeps the edit undoable', async () => {
    const props = fixture();
    const initial =
      'before ![alt](https://example.test/image.png "title") after';
    const imageStart = initial.indexOf('![');
    const imageEnd = initial.indexOf(')', imageStart) + 1;
    props.submissionField.value = initial;
    props.submissionField.defaultValue = initial;
    props.submissionField.setSelectionRange(imageStart, imageEnd);
    const view = render(
      <EditorRoot {...props} editorBlockIndexPort={imageBlockIndexPort()} />
    );
    const source = await waitFor(() => {
      const element = view.container.querySelector<HTMLElement>('.cm-content');
      if (!element) throw new Error('source-surface-missing');
      return element;
    });

    layoutContextMenuSurface(source);
    fireEvent.contextMenu(source, { clientX: 20, clientY: 24 });
    await within(document.body).findByRole('menuitem', {
      name: 'Delete image'
    });
    fireEvent.click(
      within(document.body).getByRole('menuitem', { name: 'Delete image' })
    );
    await waitFor(() =>
      expect(props.submissionField.value).toBe('before  after')
    );
    fireEvent.click(view.getByRole('button', { name: 'Undo' }));
    expect(EditorView.findFromDOM(source)?.state.doc.toString()).toBe(initial);
    view.unmount();
  });

  it('deletes only a captured Source thematic break with one undoable canonical edit', async () => {
    const props = fixture();
    const initial = 'before\n\n  ---  \nafter';
    const expected = 'before\n\n\nafter';
    const markerStart = initial.indexOf('---');
    props.submissionField.value = initial;
    props.submissionField.defaultValue = initial;
    props.submissionField.setSelectionRange(markerStart, markerStart + 3);
    const view = render(
      <EditorRoot {...props} editorBlockIndexPort={sourceLinkBlockIndexPort()} />
    );
    const source = await waitFor(() => {
      const element = view.container.querySelector<HTMLElement>('.cm-content');
      if (!element) throw new Error('source-surface-missing');
      return element;
    });
    const sourceView = EditorView.findFromDOM(source);
    if (!sourceView) throw new Error('source-view-missing');
    const beforeHistoryDepth = undoDepth(sourceView.state);

    layoutContextMenuSurface(source);
    fireEvent.contextMenu(source, { clientX: 20, clientY: 24 });
    const deleteItem = await within(document.body).findByRole('menuitem', {
      name: 'Delete horizontal rule'
    });
    expect(deleteItem.getAttribute('aria-disabled')).toBe('false');
    fireEvent.click(deleteItem);

    await waitFor(() => expect(props.submissionField.value).toBe(expected));
    expect(EditorView.findFromDOM(source)?.state.doc.toString()).toBe(expected);
    expect(undoDepth(EditorView.findFromDOM(source)?.state ?? sourceView.state)).toBe(
      beforeHistoryDepth + 1
    );

    fireEvent.click(view.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(props.submissionField.value).toBe(initial));
    expect(EditorView.findFromDOM(source)?.state.doc.toString()).toBe(initial);
    view.unmount();
  });

  it('copies a Preview-certified same-origin image through deferred Clipboard without changing Markdown', async () => {
    const props = fixture();
    const sourceMarkdown =
      'before ![alt](https://example.test/image.png "title") after';
    const imageStart = sourceMarkdown.indexOf('![');
    const imageEnd = sourceMarkdown.indexOf(')', imageStart) + 1;
    props.submissionField.value = sourceMarkdown;
    props.submissionField.defaultValue = sourceMarkdown;
    props.submissionField.setSelectionRange(imageStart, imageEnd);
    const rendered =
      '<p><img src="https://example.test/image.png" alt="alt" title="title"></p>' as SafePreviewHtml;
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      Promise.resolve(createPreviewResponse(request, rendered, {}))
    );
    const editorBlockIndexPort = imageBlockIndexPort();
    const imageIndexHydrator = vi.spyOn(
      generatedImageTarget,
      'hydrateGeneratedImageTargetIndex'
    );
    const imageParser = vi.spyOn(imageScaleContract, 'parseMarkdownImageScale');
    const extracted = deferred<EditorImagePixelsResult>();
    const editorImagePixelsPort: EditorImagePixelsPort = {
      canExtract: vi.fn(() => true),
      dispose: vi.fn(),
      extractPng: vi.fn(() => extracted.promise),
      supports: vi.fn(() => true)
    };
    const writeImageDeferred = vi.fn(async (image: Promise<Blob>) => {
      await image;
      return { status: 'written' as const };
    });
    const editorClipboardPort = {
      ...props.editorClipboardPort,
      writeImageDeferred
    } as EditorClipboardPort;
    const view = render(
      <EditorRoot
        {...props}
        editorBlockIndexPort={editorBlockIndexPort}
        editorClipboardPort={editorClipboardPort}
        editorImagePixelsPort={editorImagePixelsPort}
        generatedContentExportSession={
          {
            copyAsImage: vi.fn().mockResolvedValue({ status: 'copied' }),
            copyMathMl: vi.fn().mockResolvedValue({ status: 'copied' }),
            dispose: vi.fn(),
          } as GeneratedContentExportSession
        }
      />
    );
    const source = await waitFor(() => {
      const element = view.container.querySelector<HTMLElement>('.cm-content');
      if (!element) throw new Error('source-surface-missing');
      return element;
    });
    await waitFor(() =>
      expect(view.container.querySelector('img')).not.toBeNull()
    );

    layoutContextMenuSurface(source);
    fireEvent.contextMenu(source, { clientX: 20, clientY: 24 });
    await waitFor(() => expect(editorBlockIndexPort.build).toHaveBeenCalled());
    const copyImage = await within(document.body).findByRole('menuitem', {
      name: 'Copy image'
    });
    await waitFor(() =>
      expect(copyImage.getAttribute('aria-disabled')).toBe('false')
    );
    expect(imageIndexHydrator).toHaveBeenCalledOnce();
    const parserCallsAfterHydration = imageParser.mock.calls.length;
    fireEvent.contextMenu(document.body);
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    fireEvent.contextMenu(source, { clientX: 24, clientY: 28 });
    const currentCopyImage = await within(document.body).findByRole(
      'menuitem',
      {
        name: 'Copy image'
      }
    );
    expect(imageParser).toHaveBeenCalledTimes(parserCallsAfterHydration);
    expect(imageIndexHydrator).toHaveBeenCalledOnce();
    fireEvent.click(currentCopyImage);
    await waitFor(() => expect(writeImageDeferred).toHaveBeenCalledOnce());
    expect(editorImagePixelsPort.extractPng).toHaveBeenCalledOnce();
    expect(props.submissionField.value).toBe(sourceMarkdown);

    extracted.resolve({
      blob: new Blob(['png'], { type: 'image/png' }),
      height: 2,
      pixelCount: 4,
      source: 'https://example.test/image.png',
      status: 'extracted',
      width: 2
    });
    await waitFor(() =>
      expect(writeImageDeferred).toHaveResolvedWith({ status: 'written' })
    );
    expect(props.submissionField.value).toBe(sourceMarkdown);
    view.unmount();
  });

  it('keeps Copy image unavailable when native pixels are denied', async () => {
    const props = fixture();
    const sourceMarkdown = '![alt](https://example.test/image.png)';
    const imageStart = sourceMarkdown.indexOf('![');
    const imageEnd = sourceMarkdown.length;
    props.submissionField.value = sourceMarkdown;
    props.submissionField.defaultValue = sourceMarkdown;
    props.submissionField.setSelectionRange(imageStart, imageEnd);
    const rendered =
      '<p><img src="https://example.test/image.png" alt="alt"></p>' as SafePreviewHtml;
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      Promise.resolve(createPreviewResponse(request, rendered, {}))
    );
    const editorBlockIndexPort = imageBlockIndexPort();
    const editorImagePixelsPort: EditorImagePixelsPort = {
      canExtract: vi.fn(() => false),
      dispose: vi.fn(),
      extractPng: vi.fn(),
      supports: vi.fn(() => false)
    };
    const view = render(
      <EditorRoot
        {...props}
        editorBlockIndexPort={editorBlockIndexPort}
        editorImagePixelsPort={editorImagePixelsPort}
      />
    );
    const source = await waitFor(() => {
      const element = view.container.querySelector<HTMLElement>('.cm-content');
      if (!element) throw new Error('source-surface-missing');
      return element;
    });
    await waitFor(() =>
      expect(view.container.querySelector('img')).not.toBeNull()
    );
    layoutContextMenuSurface(source);
    fireEvent.contextMenu(source, { clientX: 20, clientY: 24 });
    await waitFor(() => expect(editorBlockIndexPort.build).toHaveBeenCalled());
    const copyImage = await within(document.body).findByRole('menuitem', {
      name: 'Copy image'
    });
    await waitFor(() =>
      expect(copyImage.getAttribute('aria-disabled')).toBe('true')
    );
    expect(editorImagePixelsPort.extractPng).not.toHaveBeenCalled();
    expect(props.submissionField.value).toBe(sourceMarkdown);
    view.unmount();
  });

  it('reuses hydrated image ranges for repeated dense-source menu capture', async () => {
    const props = fixture();
    const imageCount = 40_000;
    const sourceMarkdown = Array.from(
      { length: imageCount },
      () => '![](x)'
    ).join('\n');
    const lastImageStart = sourceMarkdown.lastIndexOf('![');
    props.submissionField.value = sourceMarkdown;
    props.submissionField.defaultValue = sourceMarkdown;
    props.submissionField.setSelectionRange(
      lastImageStart,
      lastImageStart + '![](x)'.length
    );
    const editorBlockIndexPort = imageBlockIndexPort();
    const imageParser = vi.spyOn(imageScaleContract, 'parseMarkdownImageScale');
    const imageIndexHydrator = vi.spyOn(
      generatedImageTarget,
      'hydrateGeneratedImageTargetIndex'
    );
    const view = render(
      <EditorRoot {...props} editorBlockIndexPort={editorBlockIndexPort} />
    );
    const source = await waitFor(() => {
      const element = view.container.querySelector<HTMLElement>('.cm-content');
      if (!element) throw new Error('source-surface-missing');
      return element;
    });
    layoutContextMenuSurface(source);
    fireEvent.contextMenu(source, { clientX: 20, clientY: 24 });
    await waitFor(() => expect(editorBlockIndexPort.build).toHaveBeenCalled());
    const hydration = imageIndexHydrator.mock.results[0]?.value;
    if (!hydration || 'function' !== typeof hydration.then) {
      throw new Error('image-index-hydration-missing');
    }
    await hydration;
    await within(document.body).findByRole('menuitem', { name: 'Copy image' });
    const parserCallsAfterHydration = imageParser.mock.calls.length;
    fireEvent.contextMenu(source, { clientX: 24, clientY: 28 });
    await within(document.body).findByRole('menuitem', { name: 'Copy image' });
    expect(imageParser).toHaveBeenCalledTimes(parserCallsAfterHydration);
    expect(props.submissionField.value).toBe(sourceMarkdown);
    view.unmount();
  });

  it('keeps source structure unavailable until the async worker index is ready', async () => {
    const props = fixture();
    const sourceValue = '```\ncode\n```';
    props.submissionField.value = sourceValue;
    props.submissionField.defaultValue = sourceValue;
    props.submissionField.setSelectionRange(0, sourceValue.length);
    const pending = deferred<EditorMarkdownBlockIndexData>();
    const editorBlockIndexPort: EditorMarkdownBlockIndexPort = {
      build: vi.fn(() => pending.promise),
      dispose: vi.fn()
    };
    const view = render(
      <EditorRoot {...props} editorBlockIndexPort={editorBlockIndexPort} />
    );
    const source = await waitFor(() => {
      const element = view.container.querySelector<HTMLElement>('.cm-content');
      if (!element) throw new Error('source-surface-missing');
      return element;
    });
    layoutContextMenuSurface(source);
    fireEvent.contextMenu(source, { clientX: 20, clientY: 24 });
    expect(within(document.body).queryByRole('menu')).toBeNull();
    await waitFor(() =>
      expect(editorBlockIndexPort.build).toHaveBeenCalledOnce()
    );

    pending.resolve({
      blocks: [
        {
          editable: true,
          from: 0,
          kind: 'code',
          lineEnd: 2,
          lineStart: 0,
          to: sourceValue.length
        }
      ],
      imageBlocks: [{ count: 0, firstImageIndex: 0, status: 'ready' }],
      imageRanges: [],
      length: sourceValue.length,
      mathSpans: []
    });
    expect(
      await within(document.body).findByRole('menuitem', {
        name: 'Code block'
      })
    ).toBeTruthy();
    view.unmount();
  });

  it('keeps an exhausted block-index failure unavailable instead of pending forever', async () => {
    const props = fixture();
    const onFailure = vi.fn();
    const editorBlockIndexPort: EditorMarkdownBlockIndexPort = {
      build: vi.fn(async () => {
        throw new Error('worker-failed');
      }),
      dispose: vi.fn()
    };
    const view = render(
      <EditorRoot
        {...props}
        editorBlockIndexPort={editorBlockIndexPort}
        onFailure={onFailure}
      />
    );
    const source = await waitFor(() => {
      const element = view.container.querySelector<HTMLElement>('.cm-content');
      if (!element) throw new Error('source-surface-missing');
      return element;
    });
    layoutContextMenuSurface(source);
    fireEvent.contextMenu(source, { clientX: 20, clientY: 24 });
    await waitFor(() =>
      expect(editorBlockIndexPort.build).toHaveBeenCalledTimes(2)
    );
    expect(within(document.body).queryByRole('menu')).toBeNull();
    const failureCount = onFailure.mock.calls.length;

    fireEvent.contextMenu(source, { clientX: 24, clientY: 28 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(editorBlockIndexPort.build).toHaveBeenCalledTimes(2);
    expect(onFailure.mock.calls.length).toBeGreaterThanOrEqual(
      failureCount
    );
    expect(within(document.body).queryByRole('menu')).toBeNull();
    view.unmount();
  });

  it('opens the original menu after a same-key block-index retry resolves', async () => {
    const props = fixture();
    const sourceValue = '```\ncode\n```';
    props.submissionField.value = sourceValue;
    props.submissionField.defaultValue = sourceValue;
    props.submissionField.setSelectionRange(0, sourceValue.length);
    const retry = deferred<EditorMarkdownBlockIndexData>();
    const editorBlockIndexPort: EditorMarkdownBlockIndexPort = {
      build: vi
        .fn()
        .mockRejectedValueOnce(new Error('first-failure'))
        .mockImplementationOnce(() => retry.promise),
      dispose: vi.fn()
    };
    const view = render(
      <EditorRoot {...props} editorBlockIndexPort={editorBlockIndexPort} />
    );
    const source = await waitFor(() => {
      const element = view.container.querySelector<HTMLElement>('.cm-content');
      if (!element) throw new Error('source-surface-missing');
      return element;
    });
    layoutContextMenuSurface(source);
    fireEvent.contextMenu(source, { clientX: 20, clientY: 24 });
    await waitFor(() =>
      expect(editorBlockIndexPort.build).toHaveBeenCalledTimes(2)
    );
    expect(within(document.body).queryByRole('menu')).toBeNull();

    retry.resolve({
      blocks: [
        {
          editable: true,
          from: 0,
          kind: 'code',
          lineEnd: 2,
          lineStart: 0,
          to: sourceValue.length
        }
      ],
      imageBlocks: [{ count: 0, firstImageIndex: 0, status: 'ready' }],
      imageRanges: [],
      length: sourceValue.length,
      mathSpans: []
    });
    await within(document.body).findByRole('menuitem', { name: 'Code block' });
    view.unmount();
  });

  it('mounts the shared context menu through the complete visual owner', async () => {
    const props = fixture();
    props.submissionField.value = 'Rendered';
    props.submissionField.defaultValue = 'Rendered';
    const view = render(<EditorRoot {...props} />);
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    fireEvent.click(
      await view.findByRole('button', { name: '解除锁定并编辑' })
    );
    const visual = await view.findByRole('textbox', {
      name: '可视化文章编辑器'
    });
    const range = document.createRange();
    range.selectNodeContents(visual);
    const nativeSelection = window.getSelection();
    nativeSelection?.removeAllRanges();
    nativeSelection?.addRange(range);

    layoutContextMenuSurface(visual);
    fireEvent.contextMenu(visual, { clientX: 24, clientY: 30 });
    const visualMenu = await within(document.body).findByRole('menu');
    expect(visualMenu).toBeTruthy();
    expect(
      visualMenu.closest<HTMLElement>('[data-easymde-context-menu="true"]')
        ?.style.clipPath
    ).toBe('');
    expect(
      within(document.body).getByRole('menuitem', { name: 'Copy' })
    ).toBeTruthy();
    view.unmount();
  });

  it('cuts through the complete visual owner only after the Clipboard write succeeds', async () => {
    const props = fixture();
    props.submissionField.value = 'Rendered';
    props.submissionField.defaultValue = 'Rendered';
    const view = render(<EditorRoot {...props} />);
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    fireEvent.click(
      await view.findByRole('button', { name: '解除锁定并编辑' })
    );
    const visual = await view.findByRole('textbox', {
      name: '可视化文章编辑器'
    });
    const range = document.createRange();
    range.selectNodeContents(visual);
    const nativeSelection = window.getSelection();
    nativeSelection?.removeAllRanges();
    nativeSelection?.addRange(range);

    layoutContextMenuSurface(visual);
    fireEvent.contextMenu(visual, { clientX: 24, clientY: 30 });
    await within(document.body).findByRole('menu');
    fireEvent.click(
      within(document.body).getByRole('menuitem', { name: 'Cut' })
    );
    await waitFor(() =>
      expect(props.editorClipboardPort?.write).toHaveBeenCalledWith(
        'Rendered',
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      )
    );
    await waitFor(() => expect(props.submissionField.value).toBe(''));
    view.unmount();
  });

  it('pastes through the complete visual owner without leaving Visual mode', async () => {
    const props = fixture();
    props.submissionField.value = 'Rendered';
    props.submissionField.defaultValue = 'Rendered';
    const clipboard = props.editorClipboardPort;
    if (!clipboard) throw new Error('clipboard-read-owner-missing');
    vi.mocked(clipboard.read).mockResolvedValue({
      status: 'available',
      text: 'Inserted'
    });
    const view = render(<EditorRoot {...props} />);
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    fireEvent.click(
      await view.findByRole('button', { name: '解除锁定并编辑' })
    );
    const visual = await view.findByRole('textbox', {
      name: '可视化文章编辑器'
    });
    const range = document.createRange();
    range.selectNodeContents(visual);
    const nativeSelection = window.getSelection();
    nativeSelection?.removeAllRanges();
    nativeSelection?.addRange(range);

    layoutContextMenuSurface(visual);
    fireEvent.contextMenu(visual, { clientX: 24, clientY: 30 });
    await within(document.body).findByRole('menu');
    fireEvent.click(
      within(document.body).getByRole('menuitem', { name: 'Paste' })
    );

    await waitFor(() => expect(clipboard.read).toHaveBeenCalledOnce());
    await waitFor(() => expect(props.submissionField.value).toBe('Inserted'));
    expect(view.getByRole('textbox', { name: '可视化文章编辑器' })).toBe(
      visual
    );
    view.unmount();
  });

  it('keeps the visual image context bound to the pointer target', async () => {
    const props = fixture();
    const sourceMarkdown =
      'Before ![alt](https://example.test/original.png) after\nHeading paragraph';
    props.submissionField.value = sourceMarkdown;
    props.submissionField.defaultValue = sourceMarkdown;
    props.submissionField.setSelectionRange(0, 0);
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      Promise.resolve(
        createPreviewResponse(
          request,
          '<p>Before <img alt="alt" src="https://example.test/original.png"> after</p><h1>Heading paragraph</h1>' as SafePreviewHtml,
          {}
        )
      )
    );
    const view = render(
      <EditorRoot {...props} editorBlockIndexPort={imageBlockIndexPort()} />
    );
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
    fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
    const visual = await view.findByRole('textbox', {
      name: '可视化文章编辑器'
    });
    const image = visual.querySelector('img');
    if (!(image instanceof HTMLImageElement)) {
      throw new Error('visual-context-image-missing');
    }
    const heading = visual.querySelector('h1');
    if (!(heading instanceof HTMLElement)) {
      throw new Error('visual-context-heading-missing');
    }
    const nativeSelection = window.getSelection();
    const selectNode = (node: Node): void => {
      const range = document.createRange();
      range.selectNode(node);
      nativeSelection?.removeAllRanges();
      nativeSelection?.addRange(range);
    };
    // A real session leaves the hit image node selected after the image menu
    // ran, so the later non-image right click still owns that stale selection.
    selectNode(image);
    layoutContextMenuSurface(visual);
    fireEvent.contextMenu(image, { clientX: 24, clientY: 30 });
    const imageMenu = await within(document.body).findByRole('menu');
    expect(
      within(imageMenu).getByRole('menuitem', { name: 'Image scale' })
    ).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() =>
      expect(within(document.body).queryByRole('menu')).toBeNull()
    );

    fireEvent.contextMenu(heading, { clientX: 24, clientY: 30 });
    const headingMenu = await within(document.body).findByRole('menu');
    expect(
      within(headingMenu).queryByRole('menuitem', { name: 'Image scale' })
    ).toBeNull();
    expect(
      within(headingMenu).queryByRole('menuitem', { name: 'Delete image' })
    ).toBeNull();
    expect(
      within(headingMenu).queryByRole('menuitem', { name: 'Upload image' })
    ).toBeNull();
    expect(
      within(headingMenu).queryByRole('menuitem', { name: 'Copy image' })
    ).toBeNull();
    view.unmount();
  });

  it('fails the image context explicitly when the accepted Preview no longer owns the hit image', async () => {
    const props = fixture();
    const sourceMarkdown =
      'Before ![alt](https://example.test/original.png) after\nHeading paragraph';
    props.submissionField.value = sourceMarkdown;
    props.submissionField.defaultValue = sourceMarkdown;
    props.submissionField.setSelectionRange(0, 0);
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      Promise.resolve(
        createPreviewResponse(
          request,
          '<p>Before <img alt="alt" src="https://example.test/original.png"> after</p><h1>Heading paragraph</h1>' as SafePreviewHtml,
          {}
        )
      )
    );
    const view = render(
      <EditorRoot {...props} editorBlockIndexPort={imageBlockIndexPort()} />
    );
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
    fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
    const visual = await view.findByRole('textbox', {
      name: '可视化文章编辑器'
    });
    const image = visual.querySelector('img');
    if (!(image instanceof HTMLImageElement)) {
      throw new Error('visual-context-image-missing');
    }
    layoutContextMenuSurface(visual);
    fireEvent.contextMenu(image, { clientX: 24, clientY: 30 });
    const imageMenu = await within(document.body).findByRole('menu');
    expect(
      within(imageMenu).getByRole('menuitem', { name: 'Image scale' })
    ).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() =>
      expect(within(document.body).queryByRole('menu')).toBeNull()
    );

    // A Windowed-style DOM replacement retires the element the accepted
    // Preview certified: the new live <img> is still the pointer target, but
    // no image lease can be verified for it. Image commands must fail
    // explicitly instead of silently degrading to the generic text menu.
    const replacement = image.cloneNode(true) as HTMLImageElement;
    image.replaceWith(replacement);
    fireEvent.contextMenu(replacement, { clientX: 24, clientY: 30 });
    expect(props.onFailure).toHaveBeenCalledWith(
      'editor-context-menu-image-stale'
    );
    expect(within(document.body).queryByRole('menu')).toBeNull();
    view.unmount();
  });

  it('keeps a paragraph image menu off a selection that names the sibling image', async () => {
    const props = fixture();
    const sourceMarkdown =
      'Before ![a](https://example.test/a.png) mid ![b](https://example.test/b.png) after';
    props.submissionField.value = sourceMarkdown;
    props.submissionField.defaultValue = sourceMarkdown;
    props.submissionField.setSelectionRange(0, 0);
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      Promise.resolve(
        createPreviewResponse(
          request,
          '<p>Before <img alt="a" src="https://example.test/a.png"> mid <img alt="b" src="https://example.test/b.png"> after</p>' as SafePreviewHtml,
          {}
        )
      )
    );
    const view = render(
      <EditorRoot {...props} editorBlockIndexPort={imageBlockIndexPort()} />
    );
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
    fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
    const visual = await view.findByRole('textbox', {
      name: '可视化文章编辑器'
    });
    const [imageA, imageB] = Array.from(visual.querySelectorAll('img'));
    if (
      !(imageA instanceof HTMLImageElement)
      || !(imageB instanceof HTMLImageElement)
    ) {
      throw new Error('visual-context-images-missing');
    }
    const nativeSelection = window.getSelection();
    const selectNode = (node: Node): void => {
      const range = document.createRange();
      range.selectNode(node);
      nativeSelection?.removeAllRanges();
      nativeSelection?.addRange(range);
    };
    // A deliberate non-collapsed source selection names image B while the
    // pointer hits image A. The menu must not borrow B's image lease, so no
    // image command may appear and B must stay untouched.
    selectNode(imageB);
    layoutContextMenuSurface(visual);
    fireEvent.contextMenu(imageA, { clientX: 24, clientY: 30 });
    const foreignMenu = await within(document.body).findByRole('menu');
    for (const name of [
      'Image scale',
      'Delete image',
      'Copy image',
      'Upload image'
    ]) {
      expect(
        within(foreignMenu).queryByRole('menuitem', { name })
      ).toBeNull();
    }
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() =>
      expect(within(document.body).queryByRole('menu')).toBeNull()
    );
    expect(props.submissionField.value).toBe(sourceMarkdown);

    // The same pointer target with its own selection keeps its own image
    // commands and deletes only that image.
    selectNode(imageA);
    fireEvent.contextMenu(imageA, { clientX: 24, clientY: 30 });
    const imageMenu = await within(document.body).findByRole('menu');
    const deleteImage = within(imageMenu).getByRole('menuitem', {
      name: 'Delete image'
    });
    expect(deleteImage.getAttribute('aria-disabled')).toBe('false');
    fireEvent.click(deleteImage);
    await waitFor(() =>
      expect(props.submissionField.value).toBe(
        'Before  mid ![b](https://example.test/b.png) after'
      )
    );
    view.unmount();
  });

  it('keeps a cross-block duplicate image menu off the selection image', async () => {
    const props = fixture();
    const sourceMarkdown =
      'First ![dup](https://example.test/dup.png)\nSecond ![dup](https://example.test/dup.png)';
    props.submissionField.value = sourceMarkdown;
    props.submissionField.defaultValue = sourceMarkdown;
    props.submissionField.setSelectionRange(0, 0);
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      Promise.resolve(
        createPreviewResponse(
          request,
          '<p>First <img alt="dup" src="https://example.test/dup.png"></p><h2>Second <img alt="dup" src="https://example.test/dup.png"></h2>' as SafePreviewHtml,
          {}
        )
      )
    );
    const view = render(
      <EditorRoot {...props} editorBlockIndexPort={imageBlockIndexPort()} />
    );
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
    fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
    const visual = await view.findByRole('textbox', {
      name: '可视化文章编辑器'
    });
    const [imageA, imageB] = Array.from(visual.querySelectorAll('img'));
    if (
      !(imageA instanceof HTMLImageElement)
      || !(imageB instanceof HTMLImageElement)
    ) {
      throw new Error('visual-context-images-missing');
    }
    const nativeSelection = window.getSelection();
    const selectNode = (node: Node): void => {
      const range = document.createRange();
      range.selectNode(node);
      nativeSelection?.removeAllRanges();
      nativeSelection?.addRange(range);
    };
    // Duplicate rendered URLs must not let the block-local ordinal proof fall
    // back to the selection's image in the other block.
    selectNode(imageB);
    layoutContextMenuSurface(visual);
    fireEvent.contextMenu(imageA, { clientX: 24, clientY: 30 });
    const foreignMenu = await within(document.body).findByRole('menu');
    expect(
      within(foreignMenu).queryByRole('menuitem', { name: 'Delete image' })
    ).toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() =>
      expect(within(document.body).queryByRole('menu')).toBeNull()
    );
    expect(props.submissionField.value).toBe(sourceMarkdown);

    selectNode(imageA);
    fireEvent.contextMenu(imageA, { clientX: 24, clientY: 30 });
    const imageMenu = await within(document.body).findByRole('menu');
    fireEvent.click(
      within(imageMenu).getByRole('menuitem', { name: 'Delete image' })
    );
    await waitFor(() =>
      expect(props.submissionField.value).toBe(
        'First \nSecond ![dup](https://example.test/dup.png)'
      )
    );
    view.unmount();
  });

  it('keeps a failed visual Cut transfer an explicit failure after the canonical write', async () => {
    const props = fixture();
    props.submissionField.value = 'Rendered paragraph';
    props.submissionField.defaultValue = 'Rendered paragraph';
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      Promise.resolve(
        createPreviewResponse(
          request,
          `<p>${request.markdown}</p>` as SafePreviewHtml,
          {}
        )
      )
    );
    const view = render(<EditorRoot {...props} />);
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
    fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
    const visual = await view.findByRole('textbox', {
      name: '可视化文章编辑器'
    });
    const paragraph = visual.querySelector('p');
    const text = paragraph?.firstChild;
    if (!(paragraph instanceof HTMLElement) || !(text instanceof Text)) {
      throw new Error('visual-cut-selection-target-missing');
    }
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 8);
    const nativeSelection = window.getSelection();
    nativeSelection?.removeAllRanges();
    nativeSelection?.addRange(range);
    visual.focus();

    layoutContextMenuSurface(visual);
    fireEvent.contextMenu(paragraph, { clientX: 24, clientY: 30 });
    await within(document.body).findByRole('menu');
    fireEvent.click(
      within(document.body).getByRole('menuitem', { name: 'Cut' })
    );
    await waitFor(() => expect(props.submissionField.value).toBe(' paragraph'));
    // The canonical write landed, but the visual transaction that maps the
    // cut result failed. It must stay an explicit failure instead of being
    // announced as a completed command.
    const failureCodes = vi
      .mocked(props.onFailure)
      .mock.calls.map(([code]) => code);
    expect(
      failureCodes.some((code) =>
        /^visual-editor-(?:selection-map|markdown-merge)/u.test(code)
      )
    ).toBe(true);
    await waitFor(() =>
      expect(
        view.queryByRole('textbox', { name: '可视化文章编辑器' })
      ).toBeNull()
    );
    await waitFor(() =>
      expect(
        view.queryByText('The editor action could not be completed.')
      ).not.toBeNull()
    );
    view.unmount();
  });

  it('keeps a rejected Preview transfer an explicit failure after the canonical Cut write', async () => {
    const props = fixture();
    props.submissionField.value = 'Rendered paragraph';
    props.submissionField.defaultValue = 'Rendered paragraph';
    const cutMarkdown = ' paragraph';
    let rejectedOnce = false;
    vi.mocked(props.previewPort.render).mockImplementation((request) => {
      if (request.markdown === cutMarkdown && !rejectedOnce) {
        rejectedOnce = true;
        return Promise.reject(new Error('synthetic-cut-preview-rejection'));
      }
      return Promise.resolve(
        createPreviewResponse(
          request,
          `<p>${request.markdown}</p>` as SafePreviewHtml,
          {}
        )
      );
    });
    const view = render(<EditorRoot {...props} />);
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
    fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
    const visual = await view.findByRole('textbox', {
      name: '可视化文章编辑器'
    });
    const paragraph = visual.querySelector('p');
    const text = paragraph?.firstChild;
    if (!(paragraph instanceof HTMLElement) || !(text instanceof Text)) {
      throw new Error('visual-cut-selection-target-missing');
    }
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 8);
    const nativeSelection = window.getSelection();
    nativeSelection?.removeAllRanges();
    nativeSelection?.addRange(range);
    visual.focus();

    layoutContextMenuSurface(visual);
    fireEvent.contextMenu(paragraph, { clientX: 24, clientY: 30 });
    await within(document.body).findByRole('menu');
    fireEvent.click(
      within(document.body).getByRole('menuitem', { name: 'Cut' })
    );

    // The canonical write lands, but the rejected Preview transfer is a
    // visual transaction failure: it must stay visible instead of being
    // announced as a completed command.
    await waitFor(() => expect(props.submissionField.value).toBe(cutMarkdown));
    await waitFor(() =>
      expect(
        view.queryByRole('textbox', { name: '可视化文章编辑器' })
      ).toBeNull()
    );
    await waitFor(() =>
      expect(
        view.queryByText('The editor action could not be completed.')
      ).not.toBeNull()
    );
    view.unmount();
  });

  it('exposes the code block context for a visual Preview code block', async () => {
    const props = fixture();
    const sourceMarkdown = '```js\nconst value = 1;\n```\n\nTail';
    props.submissionField.value = sourceMarkdown;
    props.submissionField.defaultValue = sourceMarkdown;
    props.submissionField.setSelectionRange(0, 0);
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      Promise.resolve(
        request.markdown.includes('const value = 1;')
          ? {
              ...createCodeContentPreviewResponse(
                request,
                sourceMarkdown,
                sourceMarkdown.indexOf('const'),
                'const value = 1;\n'
              ),
              // The rendered fence owns its complete source line range,
              // closing fence terminator included, exactly like a real Preview
              // edit map.
              editMap: {
                blocks: [
                  { editable: true, endLine: 3, id: 'b0', startLine: 0 }
                ],
                coordinate: 'line',
                signature: request.signature,
                version: 1
              }
            }
          : createPreviewResponse(
              request,
              '<p>Tail</p>' as SafePreviewHtml,
              {}
            )
      )
    );
    const view = render(
      <EditorRoot
        {...props}
        editorBlockIndexPort={sourceLinkBlockIndexPort()}
      />
    );
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
    fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
    const visual = await view.findByRole('textbox', {
      name: '可视化文章编辑器'
    });
    const codeBlock = visual.querySelector('pre');
    const codeText = codeBlock?.querySelector('code')?.firstChild;
    if (!(codeBlock instanceof HTMLElement) || !(codeText instanceof Text)) {
      throw new Error('visual-code-block-missing');
    }
    const range = document.createRange();
    range.setStart(codeText, 0);
    range.collapse(true);
    const nativeSelection = window.getSelection();
    nativeSelection?.removeAllRanges();
    nativeSelection?.addRange(range);

    layoutContextMenuSurface(visual);
    fireEvent.contextMenu(codeBlock, { clientX: 24, clientY: 30 });
    const menu = await within(document.body).findByRole('menu');
    const trigger = within(menu).queryByRole('menuitem', { name: 'Code block' });
    if (!trigger) {
      const items = Array.from(
        menu.querySelectorAll('[data-easymde-context-menu-item]')
      )
        .map((item) => item.getAttribute('data-easymde-context-menu-item'))
        .join(',');
      throw new Error(`visual-code-block-menu-missing:${items}`);
    }
    fireEvent.pointerDown(trigger, { button: 0 });
    fireEvent.click(trigger);
    const submenu = await within(document.body).findByRole('menu', {
      name: 'Code block'
    });
    const deleteItem = within(submenu).getByRole('menuitem', {
      name: 'Delete code block'
    });
    expect(deleteItem.getAttribute('aria-disabled')).toBe('false');
    fireEvent.pointerDown(deleteItem, { button: 0 });
    fireEvent.click(deleteItem);
    await waitFor(() =>
      expect(props.submissionField.value).not.toContain('```')
    );
    expect(props.submissionField.value).toContain('Tail');
    expect(vi.mocked(props.onFailure).mock.calls.map((call) => call[0])).toEqual(
      []
    );
    view.unmount();
  });

  it('exposes the generated context for a visual Preview formula', async () => {
    const props = fixture();
    const sourceMarkdown = 'Before\n$x$\nAfter';
    const mathStart = sourceMarkdown.indexOf('$x$');
    props.submissionField.value = sourceMarkdown;
    props.submissionField.defaultValue = sourceMarkdown;
    props.submissionField.setSelectionRange(0, 0);
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      Promise.resolve(
        createPreviewResponse(
          request,
          '<p>Before</p><p><span class="easymde-math easymde-math-inline"><span class="katex"><span class="katex-mathml"><math><mi>x</mi></math></span></span></span></p><p>After</p>' as SafePreviewHtml,
          { math: true }
        )
      )
    );
    const editorBlockIndexPort: EditorMarkdownBlockIndexPort = {
      build: vi.fn(async ({ source }) => ({
        ...imageBlockIndexData(source),
        mathSpans: [
          {
            bodyFrom: mathStart + 1,
            bodyTo: mathStart + 2,
            displayMode: false,
            from: mathStart,
            to: mathStart + 3
          }
        ]
      })),
      dispose: vi.fn()
    };
    const generatedContentExportSession = {
      copyAsImage: vi.fn().mockResolvedValue({ status: 'copied' }),
      copyMathMl: vi.fn().mockResolvedValue({ status: 'copied' }),
      dispose: vi.fn(),
    } as GeneratedContentExportSession;
    const view = render(
      <EditorRoot
        {...props}
        editorBlockIndexPort={editorBlockIndexPort}
        generatedContentExportSession={generatedContentExportSession}
      />
    );
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
    fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
    const visual = await view.findByRole('textbox', {
      name: '可视化文章编辑器'
    });
    const math = visual.querySelector('.easymde-math');
    if (!(math instanceof HTMLElement)) {
      throw new Error('visual-generated-content-missing');
    }
    // A rendered formula cannot own the browser caret, so a plain right click
    // reaches it without any selection inside the formula root.
    window.getSelection()?.removeAllRanges();

    layoutContextMenuSurface(visual);
    fireEvent.contextMenu(math, { clientX: 24, clientY: 30 });
    const menu = await within(document.body).findByRole('menu');
    const trigger = within(menu).getByRole('menuitem', { name: 'Formula' });
    fireEvent.pointerDown(trigger, { button: 0 });
    fireEvent.click(trigger);
    const submenu = await within(document.body).findByRole('menu', {
      name: 'Formula'
    });
    expect(
      within(submenu)
        .getByRole('menuitem', { name: 'Delete' })
        .getAttribute('aria-disabled')
    ).toBe('false');
    view.unmount();
  });

  it('exposes the generated context for a visual Preview diagram', async () => {
    const props = fixture();
    const sourceMarkdown = '```mermaid\nflowchart TD\nA-->B\n```\n\nTail';
    props.submissionField.value = sourceMarkdown;
    props.submissionField.defaultValue = sourceMarkdown;
    props.submissionField.setSelectionRange(0, 0);
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      Promise.resolve(
        request.markdown.includes('flowchart TD')
          ? {
              ...createPreviewResponse(
                request,
                '<div class="easymde-mermaid" data-easymde-visual-markdown-source="flowchart TD\nA-->B"><svg></svg></div><p>Tail</p>' as SafePreviewHtml,
                { mermaid: true }
              ),
              // The rendered diagram owns its complete fenced source range,
              // closing fence terminator included, exactly like a real
              // Preview edit map.
              editMap: {
                blocks: [
                  { editable: true, endLine: 4, id: 'b0', startLine: 0 },
                  { editable: true, endLine: 6, id: 'b1', startLine: 5 }
                ],
                coordinate: 'line',
                signature: request.signature,
                version: 1
              }
            }
          : createPreviewResponse(
              request,
              '<p>Tail</p>' as SafePreviewHtml,
              {}
            )
      )
    );
    const generatedContentExportSession = {
      copyAsImage: vi.fn().mockResolvedValue({ status: 'copied' }),
      copyMathMl: vi.fn().mockResolvedValue({ status: 'copied' }),
      dispose: vi.fn()
    } as GeneratedContentExportSession;
    const view = render(
      <EditorRoot
        {...props}
        editorBlockIndexPort={sourceLinkBlockIndexPort()}
        generatedContentExportSession={generatedContentExportSession}
      />
    );
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
    fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
    const visual = await view.findByRole('textbox', {
      name: '可视化文章编辑器'
    });
    const diagram = visual.querySelector('.easymde-mermaid');
    if (!(diagram instanceof HTMLElement)) {
      throw new Error('visual-diagram-content-missing');
    }
    // A rendered diagram cannot own the browser caret, so a plain right click
    // reaches it without any selection inside the diagram root.
    window.getSelection()?.removeAllRanges();

    layoutContextMenuSurface(visual);
    fireEvent.contextMenu(diagram, { clientX: 24, clientY: 30 });
    const menu = await within(document.body).findByRole('menu');
    const trigger = within(menu).getByRole('menuitem', { name: 'Diagram' });
    fireEvent.pointerDown(trigger, { button: 0 });
    fireEvent.click(trigger);
    const submenu = await within(document.body).findByRole('menu', {
      name: 'Diagram'
    });
    expect(
      within(submenu)
        .getByRole('menuitem', { name: 'Delete' })
        .getAttribute('aria-disabled')
    ).toBe('false');
    view.unmount();
  });

  it('applies an unsupported planned Link command through the canonical Visual owner', async () => {
    const props = fixture();
    const realCreateDocumentSession = observedSourceAdapter.createCodeMirrorDocumentSession;
    const documentOwnerRef: {
      current: ReturnType<typeof realCreateDocumentSession> | null;
    } = { current: null };
    vi.spyOn(observedSourceAdapter, 'createCodeMirrorDocumentSession')
      .mockImplementation((options) => {
        const owner = realCreateDocumentSession(options);
        documentOwnerRef.current = owner;
        return owner;
      });
    props.submissionField.value = 'First heading';
    props.submissionField.defaultValue = 'First heading';
    const toolbar = {
      ...props.toolbar,
      commands: [
        ...props.toolbar.commands,
        {
          action: 'link',
          group: 'format',
          icon: 'admin-links',
          id: 'link',
          label: 'Link',
          surface: 'main'
        }
      ]
    };
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      Promise.resolve(
        createPreviewResponse(
          request,
          ('[First heading](https://)' === request.markdown
            ? '<p><a href="https://">First heading</a></p>'
            : '<p>First heading</p>') as SafePreviewHtml,
          {}
        )
      )
    );
    const view = render(<EditorRoot {...props} toolbar={toolbar} />);
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    fireEvent.click(
      await view.findByRole('button', { name: '解除锁定并编辑' })
    );
    const visual = await view.findByRole('textbox', {
      name: '可视化文章编辑器'
    });
    const owner = documentOwnerRef.current;
    if (!owner) throw new Error('visual-link-document-owner-missing');
    const beforeRevision = owner.getRevision?.();
    const beforeHistory = owner.getHistoryState();
    const text = visual.querySelector('p')?.firstChild;
    if (!(text instanceof Text))
      throw new Error('visual-link-selection-target-missing');
    const range = document.createRange();
    range.selectNodeContents(text);
    const nativeSelection = window.getSelection();
    nativeSelection?.removeAllRanges();
    nativeSelection?.addRange(range);
    visual.focus();

    fireEvent.click(view.getByRole('button', { name: 'Link' }));

    await waitFor(() =>
      expect(props.submissionField.value).toBe('[First heading](https://)')
    );
    expect(view.getByRole('textbox', { name: '可视化文章编辑器' })).toBe(
      visual
    );
    await waitFor(() =>
      expect(window.getSelection()?.toString()).toBe('First heading')
    );
    const restoredSelection = window.getSelection();
    const restoredRange = restoredSelection?.rangeCount
      ? restoredSelection.getRangeAt(0)
      : null;
    expect(restoredRange?.toString()).toBe('First heading');
    const restoredStartAnchor =
      restoredRange?.startContainer instanceof Element
        ? restoredRange.startContainer.closest('a')
        : restoredRange?.startContainer.parentElement?.closest('a');
    const restoredEndAnchor =
      restoredRange?.endContainer instanceof Element
        ? restoredRange.endContainer.closest('a')
        : restoredRange?.endContainer.parentElement?.closest('a');
    expect(restoredStartAnchor?.getAttribute('href')).toBe('https://');
    expect(restoredEndAnchor?.getAttribute('href')).toBe('https://');
    expect(document.activeElement).toBe(visual);
    expect(owner.getValue()).toBe('[First heading](https://)');
    expect(owner.getRevision?.()).toBe((beforeRevision ?? 0) + 1);
    expect(owner.getHistoryState().undoDepth).toBe(beforeHistory.undoDepth + 1);
    expect(owner.getHistoryState().redoDepth).toBe(0);
    expect(props.onFailure).not.toHaveBeenCalledWith(
      'visual-editor-canonical-change-failed'
    );
    layoutContextMenuSurface(visual);
    fireEvent.contextMenu(visual, { clientX: 24, clientY: 30 });
    expect(await within(document.body).findByRole('menu')).toBeTruthy();
    expect(props.onFailure).not.toHaveBeenCalled();
    view.unmount();
  });

  it('returns to locked Preview when a canonical Link transfer receives a stale Preview response', async () => {
    const props = fixture();
    props.submissionField.value = 'First heading';
    props.submissionField.defaultValue = 'First heading';
    const toolbar = {
      ...props.toolbar,
      commands: [
        ...props.toolbar.commands,
        {
          action: 'link',
          group: 'format',
          icon: 'admin-links',
          id: 'link',
          label: 'Link',
          surface: 'main'
        }
      ]
    };
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      Promise.resolve(
        createPreviewResponse(
          request,
          '<p>First heading</p>' as SafePreviewHtml,
          {}
        )
      )
    );
    const view = render(<EditorRoot {...props} toolbar={toolbar} />);
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    fireEvent.click(
      await view.findByRole('button', { name: '解除锁定并编辑' })
    );
    const visual = await view.findByRole('textbox', {
      name: '可视化文章编辑器'
    });
    const text = visual.querySelector('p')?.firstChild;
    if (!(text instanceof Text))
      throw new Error('visual-stale-link-selection-target-missing');
    const range = document.createRange();
    range.selectNodeContents(text);
    const nativeSelection = window.getSelection();
    nativeSelection?.removeAllRanges();
    nativeSelection?.addRange(range);
    visual.focus();

    fireEvent.click(view.getByRole('button', { name: 'Link' }));

    await waitFor(() =>
      expect(
        Boolean(
          view.container.querySelector('.easymde-immersive-shell.is-preview')
        )
      ).toBe(true)
    );
    expect(
      view.queryByRole('textbox', { name: '可视化文章编辑器' })
    ).toBeNull();
    expect(props.submissionField.value).toBe('[First heading](https://)');
    expect(props.onFailure).toHaveBeenCalledWith(
      'visual-editor-selection-map-failed'
    );
    expect(props.onFailure).not.toHaveBeenCalledWith(
      'visual-editor-canonical-change-failed'
    );
    expect(view.getByRole('alert').textContent).toBe(
      contextMenuStrings.statusActionFailed
    );
    view.unmount();
  });

  it('alerts when native pasted code loses accepted DOM provenance during input', async () => {
    const props = fixture();
    props.submissionField.value = 'old';
    props.submissionField.defaultValue = 'old';
    const fence = String.fromCharCode(96).repeat(3);
    const pastedMarkdown = `${fence}\nbody\n${fence}`;
    const pastedPreview = deferred<PreviewResponse>();
    const realCreateDocumentSession = observedSourceAdapter.createCodeMirrorDocumentSession;
    const documentOwnerRef: {
      current: ReturnType<typeof realCreateDocumentSession> | null;
    } = { current: null };
    vi.spyOn(observedSourceAdapter, 'createCodeMirrorDocumentSession')
      .mockImplementation((options) => {
        const owner = realCreateDocumentSession(options);
        documentOwnerRef.current = owner;
        return owner;
      });
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      'old' === request.markdown
        ? Promise.resolve(createPreviewResponse(request, '<p>old</p>' as SafePreviewHtml, {}))
        : pastedMarkdown === request.markdown
          ? pastedPreview.promise
          : Promise.resolve(createPreviewResponse(request, '<p>old</p>' as SafePreviewHtml, {}))
    );
    const view = render(<EditorRoot {...props} />);

    try {
      fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
      fireEvent.click(view.getByRole('button', { name: '预览' }));
      const unlock = await view.findByRole('button', { name: '解除锁定并编辑' });
      await waitFor(() => expect(unlock.hasAttribute('disabled')).toBe(false));
      fireEvent.click(unlock);
      const visual = await view.findByRole('textbox', { name: '可视化文章编辑器' });
      const sourceText = visual.querySelector('p')?.firstChild;
      if (!(sourceText instanceof Text)) throw new Error('native-paste-source-text-missing');
      const sourceRange = document.createRange();
      sourceRange.selectNodeContents(sourceText);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(sourceRange);
      visual.focus();

      fireEvent.paste(visual, {
        clipboardData: {
          files: [],
          types: ['text/plain'],
          getData: (type: string) =>
            'text/plain' === type ? pastedMarkdown : ''
        }
      });
      const owner = documentOwnerRef.current;
      if (!owner) throw new Error('native-paste-document-owner-missing');
      await waitFor(() =>
        expect(props.previewPort.render).toHaveBeenLastCalledWith(
          expect.objectContaining({ markdown: pastedMarkdown }),
          expect.any(AbortSignal)
        )
      );
      expect(owner.getValue()).toBe(pastedMarkdown);
      const [request] = vi.mocked(props.previewPort.render).mock.lastCall ?? [];
      if (!request) throw new Error('native-paste-preview-request-missing');
      const accepted = createPreviewResponse(
        request,
        '<pre><code>body\n</code></pre>' as SafePreviewHtml,
        {}
      );
      if (!accepted.editMap) throw new Error('native-paste-edit-map-missing');
      pastedPreview.resolve({
        ...accepted,
        editMap: {
          ...accepted.editMap,
          blocks: [{ id: 'b0', editable: true, startLine: 0, endLine: 3 }]
        }
      });
      await act(async () => {
        await pastedPreview.promise;
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      });
      const pre = visual.querySelector<HTMLElement>(
        'pre[data-easymde-visual-block-id="b0"]'
      );
      const code = pre?.querySelector<HTMLElement>(':scope > code');
      const originalText = code?.firstChild;
      if (!(pre instanceof HTMLElement) || !(code instanceof HTMLElement) || !(originalText instanceof Text)) {
        throw new Error('native-paste-accepted-code-missing');
      }
      const beforeValue = owner.getValue();
      const beforeRevision = owner.getRevision?.();
      const beforeHistory = owner.getHistoryState();
      visual.append(pre.cloneNode(true));
      const range = document.createRange();
      range.setStart(originalText, 2);
      range.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(range);
      visual.focus();
      await Promise.resolve();

      const beforeInput = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        data: 'x',
        inputType: 'insertText'
      });
      fireEvent(visual, beforeInput);

      expect(beforeInput.defaultPrevented).toBe(true);
      expect(props.onFailure).toHaveBeenCalledTimes(1);
      expect(props.onFailure).toHaveBeenCalledWith('visual-editor-code-body-map-stale');
      expect(owner.getValue()).toBe(beforeValue);
      expect(owner.getRevision?.()).toBe(beforeRevision);
      expect(owner.getHistoryState()).toEqual(beforeHistory);
      expect(view.queryByRole('textbox', { name: '可视化文章编辑器' })).toBeNull();
      expect(view.getByRole('alert').textContent).toBe(
        contextMenuStrings.statusActionFailed
      );
    } finally {
      view.unmount();
    }
  });

  it.each([false, true])(
    'retains the connected menu across an accepted Windowed certificate update (%s)',
    async (foreign) => {
      const props = fixture();
      const mathIndex = 1;
      const lines = Array.from({ length: 320 }, (_, index) =>
        index === mathIndex
          ? '$$x$$'
          : index === 319
            ? '$$y$$'
            : `line ${index}`
      );
      const markdown = lines.join('\n');
      props.submissionField.value = markdown;
      props.submissionField.defaultValue = markdown;
      props.submissionField.setSelectionRange(markdown.length, markdown.length);
      const html = lines
        .map((_, index) =>
          index === mathIndex
            ? '<div class="easymde-math easymde-math-block">x</div>'
            : index === 319
              ? '<div class="easymde-math easymde-math-block">y</div>'
              : `<p>line ${index}</p>`
        )
        .join('');
      vi.mocked(props.previewPort.render).mockImplementation((request) =>
        Promise.resolve(
          createPreviewResponse(request, html as SafePreviewHtml, {
            math: true
          })
        )
      );
      vi.mocked(props.enhancementPort.enhance).mockImplementation(
        async (surface) => {
          for (const math of surface.querySelectorAll<HTMLElement>(
            '.easymde-math'
          )) {
            observedKatex.render(math.textContent ?? '', math, {
              displayMode: true,
              throwOnError: false
            });
            math.dataset.easymdeRendered = '1';
          }
        }
      );

      const realPreviewOwner = observedPreviewOwner.PreviewSurfaceOwner;
      const previewRuntimeRef: {
        current: observedPreviewOwner.PreviewSurfaceRuntime | null;
      } = { current: null };
      vi.spyOn(observedPreviewOwner, 'PreviewSurfaceOwner').mockImplementation(
        (componentProps) => {
          const onReady = observedCallback(
            (runtime: observedPreviewOwner.PreviewSurfaceRuntime) => {
              previewRuntimeRef.current = runtime;
              componentProps.onReady?.(runtime);
            },
            [componentProps.onReady]
          );
          return realPreviewOwner({ ...componentProps, onReady });
        }
      );

      const realCreateDocumentSession =
        observedSourceAdapter.createCodeMirrorDocumentSession;
      const documentOwnerRef: {
        current: ReturnType<typeof realCreateDocumentSession> | null;
      } = { current: null };
      vi.spyOn(
        observedSourceAdapter,
        'createCodeMirrorDocumentSession'
      ).mockImplementation((options) => {
        const owner = realCreateDocumentSession(options);
        documentOwnerRef.current = owner;
        return owner;
      });

      const editorBlockIndexPort: EditorMarkdownBlockIndexPort = {
        build: vi.fn(
          async ({
            source
          }: Parameters<EditorMarkdownBlockIndexPort['build']>[0]) =>
            observedBlockIndex(source)
        ),
        dispose: vi.fn()
      };
      const generatedContentExportSession = {
        copyAsImage: vi.fn(),
        copyMathMl: vi.fn(),
        dispose: vi.fn(),
      } as GeneratedContentExportSession;
      const view = render(
        <EditorRoot
          {...props}
          editorBlockIndexPort={editorBlockIndexPort}
          generatedContentExportSession={generatedContentExportSession}
        />
      );
      let generatedPin: ReturnType<
        observedPreviewOwner.PreviewSurfaceRuntime['prepareGeneratedContentTargetForSelection']
      > = null;

      try {
        fireEvent.click(
          await view.findByRole('button', { name: '进入沉浸写作' })
        );
        fireEvent.click(view.getByRole('button', { name: '预览' }));
        await waitFor(() =>
          expect(view.getByText('内容已载入')).not.toBeNull()
        );
        layoutPreviewSurface(view.container);
        fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
        const visual = await view.findByRole('textbox', {
          name: '可视化文章编辑器'
        });
        const canvas = visual.closest<HTMLElement>(
          '.easymde-immersive-preview-canvas'
        );
        const owner = documentOwnerRef.current;
        if (!canvas || !owner)
          throw new Error('certificate-test-owner-missing');
        Object.defineProperty(canvas, 'clientHeight', {
          configurable: true,
          value: 240
        });
        await act(async () => {
          for (let index = 0; index < 8; index += 1) {
            await new Promise<void>((resolve) =>
              requestAnimationFrame(() => resolve())
            );
          }
        });
        expect(
          visual.querySelectorAll('[data-easymde-visual-block-id]').length
        ).toBeLessThanOrEqual(DEFAULT_PREVIEW_WINDOW_MAX_MOUNTED);
        expect(
          visual.querySelector('[data-easymde-visual-block-id="b319"]')
        ).toBeNull();

        const revision = owner.getRevision?.();
        const history = owner.getHistoryState();
        if (foreign) {
          const first = visual.querySelector<HTMLElement>(
            '[data-easymde-visual-block-id="b0"]'
          );
          if (!first) throw new Error('certificate-test-foreign-block-missing');
          first.textContent = 'foreign';
        }
        window.getSelection()?.removeAllRanges();
        await act(async () => {
          for (let index = 0; index < 12; index += 1) {
            await new Promise<void>((resolve) =>
              requestAnimationFrame(() => resolve())
            );
          }
        });
        expect(
          visual.querySelector('[data-easymde-visual-block-id="b1"]')
            ?.isConnected
        ).toBe(true);
        if (foreign) {
          canvas.scrollTop = 0;
          canvas.dispatchEvent(new Event('scroll'));
          await act(async () => {
            for (let index = 0; index < 12; index += 1) {
              await new Promise<void>((resolve) =>
                requestAnimationFrame(() => resolve())
              );
            }
          });
        }

        const math = visual.querySelector<HTMLElement>('.easymde-math');
        const katex = math?.querySelector<HTMLElement>('.katex-display');
        if (!math || !katex) throw new Error('certificate-test-math-missing');
        expect(katex.isConnected).toBe(true);
        layoutContextMenuSurface(visual);
        fireEvent.contextMenu(math, { clientX: 24, clientY: 30 });
        const formula = await within(document.body).findByRole('menuitem', {
          name: 'Formula'
        });
        fireEvent.mouseEnter(formula);
        expect(within(document.body).queryByRole('menuitem', {
          name: 'Edit'
        })).toBeNull();

        const retained = document.createRange();
        retained.selectNodeContents(katex);
        window.getSelection()?.removeAllRanges();
        window.getSelection()?.addRange(retained);
        expect(window.getSelection()?.anchorNode).toBe(katex);
        expect(window.getSelection()?.focusNode).toBe(katex);
        expect(katex.closest('[contenteditable="false"]')).not.toBeNull();

        const activeOwnerSpy = vi.spyOn(owner, 'setVisualEditingActive');
        const capturedMenu = formula.closest('[role="menu"]');
        const beforeWindowNodes = Array.from(visual.childNodes);
        const previewRuntime = previewRuntimeRef.current;
        if (!previewRuntime)
          throw new Error('certificate-test-preview-runtime-missing');
        const tailMathStart = markdown.indexOf('$$y$$');
        generatedPin = previewRuntime.prepareGeneratedContentTargetForSelection(
          {
            index: {
              ...observedBlockIndex(markdown),
              revision: owner.getRevision?.() ?? 0
            },
            selection: {
              end: tailMathStart + 5,
              start: tailMathStart
            }
          }
        );
        if (!generatedPin)
          throw new Error('certificate-test-generated-pin-missing');
        await act(async () => {
          for (let index = 0; index < 12; index += 1) {
            await new Promise<void>((resolve) =>
              requestAnimationFrame(() => resolve())
            );
          }
        });
        expect(
          Array.from(visual.childNodes).some(
            (node, index) => node !== beforeWindowNodes[index]
          )
        ).toBe(true);
        expect(formula.isConnected).toBe(true);
        expect(formula.closest('[role="menu"]')).toBe(capturedMenu);
        expect(activeOwnerSpy).not.toHaveBeenCalled();
        expect(katex.isConnected).toBe(true);

        const currentProtectedRange = document.createRange();
        currentProtectedRange.selectNodeContents(katex);
        window.getSelection()?.removeAllRanges();
        window.getSelection()?.addRange(currentProtectedRange);
        expect(window.getSelection()?.anchorNode).toBe(katex);
        expect(window.getSelection()?.focusNode).toBe(katex);

        expect(
          view.container.querySelector('.easymde-immersive-shell.is-source')
        ).toBeNull();
        expect(owner.getValue()).toBe(markdown);
        expect(props.submissionField.value).toBe(markdown);
        expect(owner.getRevision?.()).toBe(revision);
        expect(owner.getHistoryState()).toEqual(history);
      } finally {
        generatedPin?.release();
        view.unmount();
      }
    },
    10000
  );

  it('does not cut an ABA-equal source range after its canonical revision changes', async () => {
    const props = fixture();
    const initial = props.submissionField.value;
    const pending = deferred<{ status: 'written' }>();
    const write = props.editorClipboardPort?.write;
    if (!write) throw new Error('clipboard-write-owner-missing');
    vi.mocked(write).mockReturnValue(pending.promise);
    const view = render(<EditorRoot {...props} />);
    const source = await waitFor(() => {
      const element = view.container.querySelector<HTMLElement>('.cm-content');
      if (!element) throw new Error('source-surface-missing');
      return element;
    });
    layoutContextMenuSurface(source);
    fireEvent.contextMenu(source, { clientX: 20, clientY: 24 });
    await within(document.body).findByRole('menuitem', { name: 'Cut' });
    fireEvent.click(
      within(document.body).getByRole('menuitem', { name: 'Cut' })
    );
    await waitFor(() =>
      expect(props.editorClipboardPort?.write).toHaveBeenCalledWith(
        initial,
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      )
    );

    const editor = EditorView.findFromDOM(source);
    if (!editor) throw new Error('source-editor-missing');
    editor.dispatch({
      changes: { from: initial.length, insert: 'x', to: initial.length }
    });
    editor.dispatch({
      changes: { from: initial.length, insert: '', to: initial.length + 1 }
    });
    pending.resolve({ status: 'written' });
    await Promise.resolve();
    expect(editor.state.doc.toString()).toBe(initial);
    view.unmount();
  });

  it('does not paste an ABA-equal source range after its canonical revision changes', async () => {
    const props = fixture();
    const initial = props.submissionField.value;
    const pending = deferred<{ status: 'available'; text: string }>();
    const read = props.editorClipboardPort?.read;
    if (!read) throw new Error('clipboard-read-owner-missing');
    vi.mocked(read).mockReturnValue(pending.promise);
    const view = render(<EditorRoot {...props} />);
    const source = await waitFor(() => {
      const element = view.container.querySelector<HTMLElement>('.cm-content');
      if (!element) throw new Error('source-surface-missing');
      return element;
    });
    layoutContextMenuSurface(source);
    fireEvent.contextMenu(source, { clientX: 20, clientY: 24 });
    await within(document.body).findByRole('menuitem', { name: 'Paste' });
    fireEvent.click(
      within(document.body).getByRole('menuitem', { name: 'Paste' })
    );
    await waitFor(() =>
      expect(props.editorClipboardPort?.read).toHaveBeenCalledOnce()
    );

    const editor = EditorView.findFromDOM(source);
    if (!editor) throw new Error('source-editor-missing');
    editor.dispatch({
      changes: { from: initial.length, insert: 'x', to: initial.length }
    });
    editor.dispatch({
      changes: { from: initial.length, insert: '', to: initial.length + 1 }
    });
    pending.resolve({ status: 'available', text: 'replacement' });
    await Promise.resolve();
    expect(editor.state.doc.toString()).toBe(initial);
    view.unmount();
  });

  it.each([
    [false, 'imported', 'https://example.test/imported.png'],
    [false, 'unchanged', 'https://example.test/original.png'],
    [true, 'imported', 'https://example.test/imported.png'],
    [true, 'unchanged', 'https://example.test/original.png']
  ] as const)(
    'uploads a selected image through the %s visual owner without rewriting non-target bytes (%s)',
    async (windowed, status, uploadedUrl) => {
      const props = fixture();
      const imageMarkdown = '![alt](https://example.test/original.png "title")';
      const sourceMarkdown = windowed
        ? [
            'prefix',
            imageMarkdown,
            ...Array.from({ length: 159 }, (_, index) => `suffix ${index}`)
          ].join('\n')
        : ['prefix', imageMarkdown, 'suffix'].join('\n');
      const rendered = windowed
        ? [
            '<p>prefix</p>',
            '<p><img alt="alt" src="https://example.test/original.png" title="title"></p>',
            ...Array.from(
              { length: 159 },
              (_, index) => `<p>suffix ${index}</p>`
            )
          ].join('')
        : '<p>prefix</p><p><img alt="alt" src="https://example.test/original.png" title="title"></p><p>suffix</p>';
      props.submissionField.value = sourceMarkdown;
      props.submissionField.defaultValue = sourceMarkdown;
      vi.mocked(props.previewPort.render).mockImplementation((request) =>
        Promise.resolve(
          createPreviewResponse(request, rendered as SafePreviewHtml, {})
        )
      );
      let signalAbortedAtImport: boolean | null = null;
      vi.mocked(props.remoteImageImportPort.import).mockImplementation(
        async ({ signal }) => {
          signalAbortedAtImport = Boolean(signal?.aborted);
          return 'unchanged' === status
            ? {
                alt: 'remote image',
                status: 'unchanged',
                title: 'title',
                url: uploadedUrl
              }
            : {
                alt: 'remote image',
                backup: { status: 'disabled' },
                status: 'imported',
                title: 'title',
                url: uploadedUrl
              };
        }
      );
      const editorBlockIndexPort = imageBlockIndexPort();
      const frameQueue = windowed ? createQueuedAnimationFrames() : null;
      let unmountView: (() => void) | null = null;
      try {
        const view = render(
          <EditorRoot {...props} editorBlockIndexPort={editorBlockIndexPort} />
        );
        unmountView = view.unmount;
        fireEvent.click(
          await view.findByRole('button', { name: '进入沉浸写作' })
        );
        fireEvent.click(view.getByRole('button', { name: '预览' }));
        const unlock = view.getByRole('button', { name: '解除锁定并编辑' });
        if (frameQueue) {
          await drainAnimationFramesUntil(
            frameQueue,
            () =>
              !unlock.hasAttribute('disabled')
              && 'true' !== unlock.getAttribute('aria-disabled')
          );
        } else {
          await waitFor(() =>
            expect(unlock.hasAttribute('disabled')).toBe(false)
          );
        }
        fireEvent.click(unlock);

        if (frameQueue) {
          await drainAnimationFramesUntil(
            frameQueue,
            () => frameQueue.callbacks.size > 0
          );
          if (!(await drainAnimationFrameBatch(frameQueue, 0))) {
            throw new Error('windowed-upload-first-frame-missing');
          }
          const previewSurface = view.container.querySelector<HTMLElement>(
            '[data-easymde-preview-html-sink="1"]'
          );
          if (!previewSurface)
            throw new Error('windowed-upload-preview-surface-missing');
          const unlockBusy = 'true' === unlock.getAttribute('aria-busy');
          const visualReady =
            null
            !== view.queryByRole('textbox', {
              name: '可视化文章编辑器'
            });
          expect(unlockBusy || visualReady).toBe(true);
          if (unlockBusy) {
            expect(visualReady).toBe(false);
          }
          const mountedBlocks = previewSurface.querySelectorAll(
            '[data-easymde-visual-block-id]'
          );
          expect(mountedBlocks.length).toBeGreaterThan(0);
          expect(mountedBlocks.length).toBeLessThanOrEqual(160);
          expect(
            previewSurface.querySelector('[data-easymde-preview-window-spacer]')
          ).not.toBeNull();
          await drainAnimationFramesUntil(
            frameQueue,
            () =>
              null
              !== view.queryByRole('textbox', {
                name: '可视化文章编辑器'
              })
          );
        }

        const visual = frameQueue
          ? view.getByRole('textbox', { name: '可视化文章编辑器' })
          : await view.findByRole('textbox', { name: '可视化文章编辑器' });
        const imageElement = visual.querySelector('img');
        const imageBlock = imageElement?.closest<HTMLElement>(
          '[data-easymde-visual-block-id]'
        );
        if (!(imageElement instanceof HTMLImageElement) || !imageBlock) {
          throw new Error('visual-image-block-missing');
        }
        const range = document.createRange();
        range.selectNodeContents(imageBlock);
        const nativeSelection = window.getSelection();
        nativeSelection?.removeAllRanges();
        nativeSelection?.addRange(range);

        layoutContextMenuSurface(visual);
        fireEvent.contextMenu(imageElement, { clientX: 24, clientY: 30 });
        await waitFor(() =>
          expect(editorBlockIndexPort.build).toHaveBeenCalled()
        );
        await within(document.body).findByRole('menu');
        fireEvent.click(
          within(document.body).getByRole('menuitem', { name: 'Upload image' })
        );
        await waitFor(() =>
          expect(props.remoteImageImportPort.import).toHaveBeenCalledOnce()
        );
        expect(signalAbortedAtImport).toBe(false);
        const expected =
          'unchanged' === status
            ? sourceMarkdown
            : sourceMarkdown.replace(
                'https://example.test/original.png',
                uploadedUrl
              );
        await waitFor(() => expect(props.submissionField.value).toBe(expected));
        if ('unchanged' !== status) {
          // The rewritten destination keeps the whole updated image selected so
          // the visual owner never has to map a caret inside image syntax.
          const imported = imageScaleContract.parseMarkdownImageScale(
            props.submissionField.value,
            props.submissionField.value.indexOf('![')
          );
          if (!imported) throw new Error('uploaded-image-parse-missing');
          expect(props.submissionField.selectionStart).toBe(imported.start);
          expect(props.submissionField.selectionEnd).toBe(imported.end);
        }
      } finally {
        unmountView?.();
        frameQueue?.restore();
      }
    }
  );

  it('opens the visual context menu when the pointer target is the image element', async () => {
    const props = fixture();
    const sourceMarkdown = 'Before ![alt](https://example.test/original.png) after';
    props.submissionField.value = sourceMarkdown;
    props.submissionField.defaultValue = sourceMarkdown;
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      Promise.resolve(
        createPreviewResponse(
          request,
          '<p>Before <img alt="alt" src="https://example.test/original.png"> after</p>' as SafePreviewHtml,
          {}
        )
      )
    );
    const view = render(
      <EditorRoot {...props} editorBlockIndexPort={imageBlockIndexPort()} />
    );
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
    fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
    const visual = await view.findByRole('textbox', {
      name: '可视化文章编辑器'
    });
    const image = visual.querySelector('img');
    if (!(image instanceof HTMLImageElement)) {
      throw new Error('visual-context-image-missing');
    }
    const range = document.createRange();
    range.setStart(image, 0);
    range.collapse(true);
    const nativeSelection = window.getSelection();
    nativeSelection?.removeAllRanges();
    nativeSelection?.addRange(range);

    layoutContextMenuSurface(visual);
    fireEvent.contextMenu(image, { clientX: 24, clientY: 30 });

    const menu = await within(document.body).findByRole('menu');
    expect(
      within(menu).getByRole('menuitem', { name: 'Image scale' })
    ).toBeTruthy();
    const imageScaleTrigger = within(menu).getByRole('menuitem', {
      name: 'Image scale'
    });
    const collapseNativeSelection = (): void => {
      const selection = window.getSelection();
      const collapsed = document.createRange();
      collapsed.selectNodeContents(visual);
      collapsed.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(collapsed);
    };
    const expectImageNodeSelection = (): void => {
      const range = window.getSelection()?.getRangeAt(0);
      expect(range?.startContainer).toBe(image.parentNode);
      expect(range?.endContainer).toBe(image.parentNode);
      expect(range?.startOffset).not.toBe(range?.endOffset);
    };
    collapseNativeSelection();
    fireEvent.pointerDown(imageScaleTrigger, { button: 0 });
    expectImageNodeSelection();
    fireEvent.click(imageScaleTrigger);
    const imageScaleMenu = await within(document.body).findByRole('menu', {
      name: 'Image scale'
    });
    collapseNativeSelection();
    fireEvent.pointerDown(
      within(imageScaleMenu).getByRole('menuitem', { name: '100%' }),
      { button: 0 }
    );
    expectImageNodeSelection();
    fireEvent.click(
      within(imageScaleMenu).getByRole('menuitem', { name: '100%' })
    );
    await waitFor(() =>
      expect(props.submissionField.value).toContain(
        '![alt](https://example.test/original.png "{width=100%}")'
      )
    );
    expect(props.onFailure).not.toHaveBeenCalledWith(
      'visual-editor-selection-map-failed'
    );
    expect(props.onFailure).not.toHaveBeenCalledWith(
      'editor-context-menu-selection-map-failed'
    );
    view.unmount();
  });

  it.each([false, true] as const)(
    'keeps the scaled image target selected after a visual image scale action (windowed=%s)',
    async (windowed) => {
      const props = fixture();
      const firstLine =
        'Before ![alt](https://example.test/original.png "{width=100%}") after';
      const sourceMarkdown = windowed
        ? [
            firstLine,
            ...Array.from({ length: 160 }, (_, index) => `suffix ${index}`)
          ].join('\n')
        : firstLine;
      props.submissionField.value = sourceMarkdown;
      props.submissionField.defaultValue = sourceMarkdown;
      const rendered = windowed
        ? [
            '<p>Before <img alt="alt" src="https://example.test/original.png" title="{width=100%}"> after</p>',
            ...Array.from(
              { length: 160 },
              (_, index) => `<p>suffix ${index}</p>`
            )
          ].join('')
        : '<p>Before <img alt="alt" src="https://example.test/original.png" title="{width=100%}"> after</p>';
      vi.mocked(props.previewPort.render).mockImplementation((request) =>
        Promise.resolve(
          createPreviewResponse(request, rendered as SafePreviewHtml, {})
        )
      );
      const view = render(
        <EditorRoot {...props} editorBlockIndexPort={imageBlockIndexPort()} />
      );
      fireEvent.click(
        await view.findByRole('button', { name: '进入沉浸写作' })
      );
      fireEvent.click(view.getByRole('button', { name: '预览' }));
      await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
      fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
      const visual = await view.findByRole('textbox', {
        name: '可视化文章编辑器'
      });
      const currentImage = (): HTMLImageElement => {
        const image = visual.querySelector('img');
        if (!(image instanceof HTMLImageElement)) {
          throw new Error('visual-context-image-missing');
        }
        return image;
      };
      // Retain one non-collapsed image-node selection, the way an earlier
      // visual interaction leaves it behind before a later right click reuses
      // the same image target, and keep the surface focused like a real
      // editing session does.
      visual.focus();
      const retained = document.createRange();
      retained.selectNode(currentImage());
      const nativeSelection = window.getSelection();
      nativeSelection?.removeAllRanges();
      nativeSelection?.addRange(retained);
      document.dispatchEvent(new Event('selectionchange'));

      const scaleImage = async (
        percentage: '50%' | '100%'
      ): Promise<void> => {
        layoutContextMenuSurface(visual);
        fireEvent.contextMenu(currentImage(), { clientX: 24, clientY: 30 });
        const menu = await within(document.body).findByRole('menu');
        const imageScaleTrigger = within(menu).getByRole('menuitem', {
          name: 'Image scale'
        });
        fireEvent.pointerDown(imageScaleTrigger, { button: 0 });
        fireEvent.click(imageScaleTrigger);
        const imageScaleMenu = await within(document.body).findByRole('menu', {
          name: 'Image scale'
        });
        const item = within(imageScaleMenu).getByRole('menuitem', {
          name: percentage
        });
        fireEvent.pointerDown(item, { button: 0 });
        fireEvent.click(item);
      };
      const expectImageTargetSelected = (percentage: '50%' | '100%'): void => {
        const scaled = imageScaleContract.parseMarkdownImageScale(
          props.submissionField.value,
          props.submissionField.value.indexOf('![alt](')
        );
        if (!scaled) throw new Error('scaled-image-parse-missing');
        expect(scaled.scale).toBe(Number(percentage.slice(0, -1)));
        expect(props.submissionField.selectionStart).toBe(scaled.start);
        expect(props.submissionField.selectionEnd).toBe(scaled.end);
      };

      await scaleImage('50%');
      await waitFor(() =>
        expect(props.submissionField.value).toContain('"{width=50%}"')
      );
      // The canonical image target survives the write, so the visual owner
      // reports no failure and can restore the retained non-collapsed range.
      expect(props.onFailure).not.toHaveBeenCalled();
      // The canonical selection stays the complete scaled image target on both
      // surfaces, so no owner ever maps a caret inside image syntax.
      expectImageTargetSelected('50%');
      if (!windowed) {
        const restored = window.getSelection()?.getRangeAt(0);
        if (!restored) throw new Error('visual-image-selection-missing');
        expect(restored.collapsed).toBe(false);
        expect(restored.intersectsNode(currentImage())).toBe(true);
      }

      // A repeated action replays the menu after the accepted Preview window
      // re-rendered the scaled image. The replayed target is stale, so the
      // owner must rebuild a legal target/selection instead of failing.
      await scaleImage('100%');
      await waitFor(() =>
        expect(props.submissionField.value).toContain('"{width=100%}"')
      );
      expect(props.onFailure).not.toHaveBeenCalled();
      expectImageTargetSelected('100%');
      view.unmount();
    }
  );

  it('mounts the shared context menu through the windowed visual owner', async () => {
    const props = fixture();
    const markdown = Array.from(
      { length: 161 },
      (_, index) => `line ${index}`
    ).join('\n');
    props.submissionField.value = markdown;
    props.submissionField.defaultValue = markdown;
    const rendered = Array.from(
      { length: 161 },
      (_, index) => `<p>line ${index}</p>`
    ).join('');
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      Promise.resolve(
        createPreviewResponse(request, rendered as SafePreviewHtml, {})
      )
    );
    const view = render(<EditorRoot {...props} />);
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    fireEvent.click(
      await view.findByRole('button', { name: '解除锁定并编辑' })
    );
    const visual = await view.findByRole('textbox', {
      name: '可视化文章编辑器'
    });
    const range = document.createRange();
    const selectionTarget =
      visual.querySelector<HTMLElement>('[data-easymde-visual-block-id]')
      ?? visual;
    range.selectNodeContents(selectionTarget);
    const nativeSelection = window.getSelection();
    nativeSelection?.removeAllRanges();
    nativeSelection?.addRange(range);

    layoutContextMenuSurface(visual);
    fireEvent.contextMenu(visual, { clientX: 24, clientY: 30 });
    const windowedMenu = await within(document.body).findByRole('menu');
    expect(windowedMenu).toBeTruthy();
    expect(
      windowedMenu.closest<HTMLElement>('[data-easymde-context-menu="true"]')
        ?.style.clipPath
    ).toBe('');
    fireEvent.click(
      within(document.body).getByRole('menuitem', { name: 'Cut' })
    );
    await waitFor(() =>
      expect(props.editorClipboardPort?.write).toHaveBeenCalledWith(
        'line 0',
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      )
    );
    await waitFor(() =>
      expect(props.submissionField.value).not.toContain('line 0')
    );
    view.unmount();
  });

  it.each([false, true] as const)(
    'keeps generated visual Preview protected without changing Markdown (%s)',
    async (windowed) => {
      const props = fixture();
      const sourceMarkdown = windowed
        ? [
            'Before',
            '$x$',
            'After',
            ...Array.from({ length: 158 }, (_, index) => `suffix ${index}`)
          ].join('\n')
        : 'Before\n$x$\nAfter';
      const mathStart = sourceMarkdown.indexOf('$x$');
      props.submissionField.value = sourceMarkdown;
      props.submissionField.defaultValue = sourceMarkdown;
      props.submissionField.setSelectionRange(mathStart, mathStart + 3);
      const rendered = windowed
        ? [
            '<p>Before</p>',
            '<p><span class="easymde-math easymde-math-inline"><span class="katex"><span class="katex-mathml"><math><mi>x</mi></math></span></span></span></p>',
            '<p>After</p>',
            ...Array.from(
              { length: 158 },
              (_, index) => `<p>suffix ${index}</p>`
            )
          ].join('')
        : '<p>Before</p><p><span class="easymde-math easymde-math-inline"><span class="katex"><span class="katex-mathml"><math><mi>x</mi></math></span></span></span></p><p>After</p>';
      vi.mocked(props.previewPort.render).mockImplementation((request) =>
        Promise.resolve(
          createPreviewResponse(request, rendered as SafePreviewHtml, {
            math: true
          })
        )
      );
      const editorBlockIndexPort: EditorMarkdownBlockIndexPort = {
        build: vi.fn(async ({ source }) => ({
          ...imageBlockIndexData(source),
          mathSpans: [
            {
              bodyFrom: mathStart + 1,
              bodyTo: mathStart + 2,
              displayMode: false,
              from: mathStart,
              to: mathStart + 3
            }
          ]
        })),
        dispose: vi.fn()
      };
      const generatedContentExportSession = {
        copyAsImage: vi.fn().mockResolvedValue({ status: 'copied' }),
        copyMathMl: vi.fn().mockResolvedValue({ status: 'copied' }),
        dispose: vi.fn(),
      } as GeneratedContentExportSession;
      const view = render(
        <EditorRoot
          {...props}
          editorBlockIndexPort={editorBlockIndexPort}
          generatedContentExportSession={generatedContentExportSession}
        />
      );

      fireEvent.click(
        await view.findByRole('button', { name: '进入沉浸写作' })
      );
      fireEvent.click(view.getByRole('button', { name: '预览' }));
      await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
      layoutPreviewSurface(view.container);
      fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
      const visual = await view.findByRole('textbox', {
        name: '可视化文章编辑器'
      });
      const math = visual.querySelector<HTMLElement>('.easymde-math');
      if (!math) throw new Error('visual-math-missing');
      layoutContextMenuSurface(visual);
      fireEvent.contextMenu(math, { clientX: 24, clientY: 30 });
      const formula = await within(document.body).findByRole('menuitem', {
        name: 'Formula'
      });
      fireEvent.mouseEnter(formula);
      expect(within(document.body).queryByRole('menuitem', {
        name: 'Edit'
      })).toBeNull();
      expect(
        view.queryByRole('textbox', { name: '可视化文章编辑器' })
      ).not.toBeNull();
      expect(props.submissionField.value).toBe(sourceMarkdown);
      view.unmount();
    }
  );

  it.each(['text', 'same-id-replacement', 'delete'] as const)(
    'rejects %s foreign Windowed generated DOM mutations without normalizing Markdown',
    async (mutation) => {
      const props = fixture();
      const sourceMarkdown = [
        'Before',
        '$x$',
        'After',
        ...Array.from({ length: 158 }, (_, index) => `suffix ${index}`)
      ].join('\n');
      const mathStart = sourceMarkdown.indexOf('$x$');
      props.submissionField.value = sourceMarkdown;
      props.submissionField.defaultValue = sourceMarkdown;
      props.submissionField.setSelectionRange(mathStart, mathStart + 3);
      const rendered = [
        '<p>Before</p>',
        '<p><span class="easymde-math easymde-math-inline"><span class="katex"><span class="katex-mathml"><math><mi>x</mi></math></span></span></span></p>',
        '<p>After</p>',
        ...Array.from({ length: 158 }, (_, index) => `<p>suffix ${index}</p>`)
      ].join('');
      vi.mocked(props.previewPort.render).mockImplementation((request) =>
        Promise.resolve(
          createPreviewResponse(request, rendered as SafePreviewHtml, {
            math: true
          })
        )
      );
      const editorBlockIndexPort: EditorMarkdownBlockIndexPort = {
        build: vi.fn(async ({ source }) => ({
          ...imageBlockIndexData(source),
          mathSpans: [
            {
              bodyFrom: mathStart + 1,
              bodyTo: mathStart + 2,
              displayMode: false,
              from: mathStart,
              to: mathStart + 3
            }
          ]
        })),
        dispose: vi.fn()
      };
      const generatedContentExportSession = {
        copyAsImage: vi.fn().mockResolvedValue({ status: 'copied' }),
        copyMathMl: vi.fn().mockResolvedValue({ status: 'copied' }),
        dispose: vi.fn(),
      } as GeneratedContentExportSession;
      const view = render(
        <EditorRoot
          {...props}
          editorBlockIndexPort={editorBlockIndexPort}
          generatedContentExportSession={generatedContentExportSession}
        />
      );

      fireEvent.click(
        await view.findByRole('button', { name: '进入沉浸写作' })
      );
      fireEvent.click(view.getByRole('button', { name: '预览' }));
      await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
      layoutPreviewSurface(view.container);
      fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
      const visual = await view.findByRole('textbox', {
        name: '可视化文章编辑器'
      });
      const math = visual.querySelector<HTMLElement>('.easymde-math');
      if (!math) throw new Error('visual-math-missing');
      layoutContextMenuSurface(visual);
      fireEvent.contextMenu(math, { clientX: 24, clientY: 30 });
      const formula = await within(document.body).findByRole('menuitem', {
        name: 'Formula'
      });
      fireEvent.mouseEnter(formula);
      const copyGenerated = within(document.body)
        .getAllByRole('menuitem', { name: 'Copy' })
        .find((item) => item.getAttribute('aria-haspopup') === 'menu');
      if (!copyGenerated) throw new Error('generated-copy-submenu-missing');
      fireEvent.mouseEnter(copyGenerated);
      const copySource = await within(document.body).findByRole('menuitem', {
        name: 'Copy TeX'
      });
      if ('text' === mutation) {
        math.textContent = 'foreign';
      } else if ('same-id-replacement' === mutation) {
        const block = math.closest<HTMLElement>(
          '[data-easymde-visual-block-id]'
        );
        if (!block) throw new Error('visual-math-block-missing');
        const replacement = block.cloneNode(true) as HTMLElement;
        replacement
          .querySelector<HTMLElement>('.easymde-math')
          ?.replaceChildren(document.createTextNode('foreign'));
        block.replaceWith(replacement);
      } else {
        math.remove();
      }
      fireEvent.click(copySource);

      await waitFor(() => expect(props.onFailure).toHaveBeenCalled());
      expect(props.submissionField.value).toBe(sourceMarkdown);
      expect(
        view.container.querySelector('.easymde-immersive-shell.is-preview')
      ).not.toBeNull();
      expect(view.container.querySelector('.cm-content')).toBeNull();
      view.unmount();
    }
  );

  it('starts native deferred HTML Clipboard write before the formal renderer resolves', async () => {
    const props = fixture();
    const pendingRender = deferred<PreviewResponse>();
    vi.mocked(props.previewPort.render).mockImplementation(
      () => pendingRender.promise
    );
    const writeDeferred = props.editorClipboardPort?.writeDeferred;
    if (!writeDeferred) throw new Error('deferred-clipboard-fixture-missing');
    const view = render(<EditorRoot {...props} />);
    const source = await waitFor(() => {
      const element = view.container.querySelector<HTMLElement>('.cm-content');
      if (!element) throw new Error('source-surface-missing');
      return element;
    });

    layoutContextMenuSurface(source);
    fireEvent.contextMenu(source, { clientX: 20, clientY: 24 });
    await within(document.body).findByRole('menu');
    fireEvent.click(
      within(document.body).getByRole('menuitem', { name: 'Copy / Paste as' })
    );
    fireEvent.click(
      await within(document.body).findByRole('menuitem', {
        name: 'Copy as HTML code'
      })
    );

    await waitFor(() => expect(writeDeferred).toHaveBeenCalledTimes(1));
    expect(props.previewPort.render).toHaveBeenCalled();
    pendingRender.resolve(
      createPreviewResponse(
        {
          codeTheme: 'dark',
          customCssId: '',
          markdown: 'selected',
          markdownTheme: 'default',
          postId: 7,
          signature: 'context-html'
        },
        '<p>Rendered HTML</p>' as SafePreviewHtml,
        {}
      )
    );
    await waitFor(() => expect(writeDeferred).toHaveBeenCalledTimes(1));
    view.unmount();
  });

  it('uses the shared context-menu TableDialog with cancel no-op and one undoable insert', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);
    const source = await waitFor(() => {
      const element = view.container.querySelector<HTMLElement>('.cm-content');
      if (!element) throw new Error('source-surface-missing');
      return element;
    });

    const openTableDialog = async () => {
      layoutContextMenuSurface(source);
      fireEvent.contextMenu(source, { clientX: 20, clientY: 24 });
      await within(document.body).findByRole('menu');
      fireEvent.click(
        within(document.body).getByRole('menuitem', { name: 'Insert' })
      );
      fireEvent.click(
        await within(document.body).findByRole('menuitem', { name: 'Insert table above' })
      );
      return within(document.body).findByRole('dialog', { name: '插入表格' });
    };

    const dialog = await openTableDialog();
    const cancelButtons = within(await dialog).getAllByRole('button', {
      name: '取消'
    });
    const cancelButton = cancelButtons[1] ?? cancelButtons[0];
    if (!cancelButton) throw new Error('table-dialog-cancel-unavailable');
    fireEvent.click(cancelButton);
    expect(props.submissionField.value).toBe('selected');

    await openTableDialog();
    fireEvent.click(
      within(document.body).getByRole('button', { name: '3 × 3' })
    );
    await waitFor(() =>
      expect(props.submissionField.value).not.toBe('selected')
    );
    fireEvent.click(view.getByRole('button', { name: 'Undo' }));
    expect(EditorView.findFromDOM(source)?.state.doc.toString()).toBe(
      'selected'
    );
    view.unmount();
  });

  it('formats a captured Source table through one canonical undoable edit', async () => {
    const props = fixture();
    const sourceValue = '|A|B|\n|---|---|\n|1|2|';
    const cellPosition = sourceValue.indexOf('1');
    props.submissionField.value = sourceValue;
    props.submissionField.defaultValue = sourceValue;
    props.submissionField.setSelectionRange(cellPosition, cellPosition);
    const view = render(<EditorRoot {...props} />);
    const source = await waitFor(() => {
      const element = view.container.querySelector<HTMLElement>('.cm-content');
      if (!element) throw new Error('source-surface-missing');
      return element;
    });

    layoutContextMenuSurface(source);
    fireEvent.contextMenu(source, { clientX: 20, clientY: 24 });
    await within(document.body).findByRole('menu');
    const table = await within(document.body).findByRole('menuitem', { name: 'Table' });
    fireEvent.mouseEnter(table);
    const format = await within(document.body).findByRole('menuitem', {
      name: 'Format Table Source'
    });
    expect(format.getAttribute('aria-disabled')).toBe('false');
    fireEvent.click(format);

    await waitFor(() => expect(props.submissionField.value).not.toBe(sourceValue));
    const formattedValue = props.submissionField.value;
    expect(formattedValue).toContain('| A   | B   |');

    layoutContextMenuSurface(source);
    fireEvent.contextMenu(source, { clientX: 20, clientY: 24 });
    const repeatedTable = await within(document.body).findByRole('menuitem', {
      name: 'Table'
    });
    fireEvent.mouseEnter(repeatedTable);
    const repeatedFormat = await within(document.body).findByRole('menuitem', {
      name: 'Format Table Source'
    });
    expect(repeatedFormat.getAttribute('aria-disabled')).toBe('false');
    fireEvent.click(repeatedFormat);
    await waitFor(() => expect(props.submissionField.value).toBe(formattedValue));
    expect(props.onFailure).not.toHaveBeenCalled();

    fireEvent.click(view.getByRole('button', { name: 'Undo' }));
    expect(EditorView.findFromDOM(source)?.state.doc.toString()).toBe(sourceValue);
    view.unmount();
  });

  it('keeps block- and anchor-scoped table actions available for a mixed multi-row Source selection', async () => {
    const props = fixture();
    const sourceValue = '| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |';
    const firstBodyRow = sourceValue.indexOf('| 1');
    const nextRow = sourceValue.indexOf('| 3');
    props.submissionField.value = sourceValue;
    props.submissionField.defaultValue = sourceValue;
    props.submissionField.setSelectionRange(firstBodyRow, nextRow + 3);
    const view = render(
      <EditorRoot {...props} editorBlockIndexPort={sourceLinkBlockIndexPort()} />
    );
    const source = await waitFor(() => {
      const element = view.container.querySelector<HTMLElement>('.cm-content');
      if (!element) throw new Error('source-surface-missing');
      return element;
    });

    layoutContextMenuSurface(source);
    fireEvent.contextMenu(source, { clientX: 20, clientY: 24 });
    const table = await within(document.body).findByRole('menuitem', {
      name: 'Table'
    });
    fireEvent.mouseEnter(table);
    const submenu = await within(document.body).findByRole('menu', {
      name: 'Table'
    });
    const availability = (name: string): string | null =>
      within(submenu).getByRole('menuitem', { name }).getAttribute('aria-disabled');
    // The selection cannot prove a single target row, column, or alignment, so
    // those operations stay disabled while the deterministic anchor and the
    // table block itself remain actionable.
    expect(availability('Insert row above')).toBe('false');
    expect(availability('Insert column right')).toBe('false');
    expect(availability('Copy table')).toBe('false');
    expect(availability('Delete table')).toBe('false');
    expect(availability('Insert paragraph below table')).toBe('false');
    expect(availability('Delete row')).toBe('true');
    expect(availability('Delete column')).toBe('true');
    expect(availability('Alignment')).toBe('true');
    expect(props.submissionField.value).toBe(sourceValue);
    expect(view.getByRole('button', { name: 'Undo' }).hasAttribute('disabled')).toBe(
      true
    );
    view.unmount();
  });

  it('keeps whole-table alignment available while row and column deletion stay unproven', async () => {
    const props = fixture();
    const sourceValue = '| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n\nTail';
    const tableEnd = sourceValue.indexOf('\n\nTail');
    props.submissionField.value = sourceValue;
    props.submissionField.defaultValue = sourceValue;
    props.submissionField.setSelectionRange(0, tableEnd);
    const view = render(
      <EditorRoot {...props} editorBlockIndexPort={sourceLinkBlockIndexPort()} />
    );
    const source = await waitFor(() => {
      const element = view.container.querySelector<HTMLElement>('.cm-content');
      if (!element) throw new Error('source-surface-missing');
      return element;
    });

    layoutContextMenuSurface(source);
    fireEvent.contextMenu(source, { clientX: 20, clientY: 24 });
    const table = await within(document.body).findByRole('menuitem', {
      name: 'Table'
    });
    fireEvent.mouseEnter(table);
    const submenu = await within(document.body).findByRole('menu', {
      name: 'Table'
    });
    expect(
      within(submenu)
        .getByRole('menuitem', { name: 'Delete row' })
        .getAttribute('aria-disabled')
    ).toBe('true');
    expect(
      within(submenu)
        .getByRole('menuitem', { name: 'Delete column' })
        .getAttribute('aria-disabled')
    ).toBe('true');
    const alignment = within(submenu).getByRole('menuitem', {
      name: 'Alignment'
    });
    expect(alignment.getAttribute('aria-disabled')).toBe('false');
    fireEvent.mouseEnter(alignment);
    fireEvent.click(
      await within(document.body).findByRole('menuitem', { name: 'Align left' })
    );
    await waitFor(() =>
      expect(props.submissionField.value).toBe(
        '| A | B |\n| :--- | :--- |\n| 1 | 2 |\n| 3 | 4 |\n\nTail'
      )
    );
    expect(props.onFailure).not.toHaveBeenCalled();
    view.unmount();
  });

  it('applies column alignment from a real-browser column drag selection', async () => {
    const props = fixture();
    const sourceValue = '| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |';
    const firstColumnStart = sourceValue.indexOf('1');
    const firstColumnEnd = sourceValue.indexOf('3') + 1;
    props.submissionField.value = sourceValue;
    props.submissionField.defaultValue = sourceValue;
    props.submissionField.setSelectionRange(firstColumnStart, firstColumnEnd);
    const view = render(
      <EditorRoot {...props} editorBlockIndexPort={sourceLinkBlockIndexPort()} />
    );
    const source = await waitFor(() => {
      const element = view.container.querySelector<HTMLElement>('.cm-content');
      if (!element) throw new Error('source-surface-missing');
      return element;
    });

    layoutContextMenuSurface(source);
    fireEvent.contextMenu(source, { clientX: 20, clientY: 24 });
    const table = await within(document.body).findByRole('menuitem', {
      name: 'Table'
    });
    fireEvent.mouseEnter(table);
    const submenu = await within(document.body).findByRole('menu', {
      name: 'Table'
    });
    const availability = (name: string): string | null =>
      within(submenu)
        .getByRole('menuitem', { name })
        .getAttribute('aria-disabled');
    // The drag spans multiple rows inside one column: the column and the
    // anchor stay provable, while no single row is.
    expect(availability('Delete row')).toBe('true');
    expect(availability('Delete column')).toBe('false');
    expect(availability('Format Table Source')).toBe('false');
    const alignment = within(submenu).getByRole('menuitem', {
      name: 'Alignment'
    });
    expect(alignment.getAttribute('aria-disabled')).toBe('false');
    fireEvent.mouseEnter(alignment);
    fireEvent.click(
      await within(document.body).findByRole('menuitem', { name: 'Align right' })
    );
    await waitFor(() =>
      expect(props.submissionField.value).toBe(
        '| A | B |\n| ---: | --- |\n| 1 | 2 |\n| 3 | 4 |'
      )
    );
    expect(props.onFailure).not.toHaveBeenCalled();
    view.unmount();
  });

  it('does not expose table actions when the captured selection crosses the table boundary', async () => {
    const props = fixture();
    const sourceValue = '|A|B|\n|---|---|\n|1|2|\n\nTail';
    props.submissionField.value = sourceValue;
    props.submissionField.defaultValue = sourceValue;
    props.submissionField.setSelectionRange(0, sourceValue.length);
    const view = render(
      <EditorRoot {...props} editorBlockIndexPort={imageBlockIndexPort()} />
    );
    const source = await waitFor(() => {
      const element = view.container.querySelector<HTMLElement>('.cm-content');
      if (!element) throw new Error('source-surface-missing');
      return element;
    });

    layoutContextMenuSurface(source);
    fireEvent.contextMenu(source, { clientX: 20, clientY: 24 });
    await within(document.body).findByRole('menu');
    expect(within(document.body).queryByRole('menuitem', { name: 'Table' })).toBeNull();
    fireEvent.click(within(document.body).getByRole('menuitem', { name: 'Insert' }));
    expect(
      within(document.body).getByRole('menuitem', { name: 'Insert paragraph above' })
        .getAttribute('aria-disabled')
    ).toBe('true');
    expect(props.submissionField.value).toBe(sourceValue);
    expect(view.getByRole('button', { name: 'Undo' }).hasAttribute('disabled')).toBe(true);
    expect(props.onFailure).not.toHaveBeenCalled();
    view.unmount();
  });

  it('copies parser-proven code content without fences or document mutation', async () => {
    const props = fixture();
    const sourceValue = [
      'before',
      '```ts',
      'const value = 1;',
      '',
      '```',
      'after'
    ].join('\n');
    const codePosition = sourceValue.indexOf('const value');
    props.submissionField.value = sourceValue;
    props.submissionField.defaultValue = sourceValue;
    props.submissionField.setSelectionRange(codePosition, codePosition);
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      Promise.resolve(
        createCodeContentPreviewResponse(
          request,
          sourceValue,
          codePosition,
          'const value = 1;\n\n'
        )
      )
    );
    const clipboard = props.editorClipboardPort;
    if (!clipboard) throw new Error('clipboard-write-owner-missing');
    const view = render(<EditorRoot {...props} />);
    const source = await waitFor(() => {
      const element = view.container.querySelector<HTMLElement>('.cm-content');
      if (!element) throw new Error('source-surface-missing');
      return element;
    });

    layoutContextMenuSurface(source);
    fireEvent.contextMenu(source, { clientX: 20, clientY: 24 });
    const codeBlock = await within(document.body).findByRole('menuitem', {
      name: 'Code block'
    });
    fireEvent.mouseEnter(codeBlock);
    const copyContent = await within(document.body).findByRole('menuitem', {
      name: 'Copy Code Block Content'
    });
    expect(copyContent.getAttribute('aria-disabled')).toBe('false');
    fireEvent.click(copyContent);

    await waitFor(() => expect(clipboard.write).toHaveBeenCalledWith(
      'const value = 1;\n\n',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    ));
    expect(props.submissionField.value).toBe(sourceValue);
    expect(props.onFailure).not.toHaveBeenCalled();
    view.unmount();
  });

  it('does not expose code-block actions when the captured selection crosses its boundary', async () => {
    const props = fixture();
    const sourceValue = '```js\nconst value = 1;\n```\n\nTail';
    props.submissionField.value = sourceValue;
    props.submissionField.defaultValue = sourceValue;
    props.submissionField.setSelectionRange(0, sourceValue.length);
    const view = render(
      <EditorRoot {...props} editorBlockIndexPort={imageBlockIndexPort()} />
    );
    const source = await waitFor(() => {
      const element = view.container.querySelector<HTMLElement>('.cm-content');
      if (!element) throw new Error('source-surface-missing');
      return element;
    });

    layoutContextMenuSurface(source);
    fireEvent.contextMenu(source, { clientX: 20, clientY: 24 });
    await within(document.body).findByRole('menu');
    expect(within(document.body).queryByRole('menuitem', { name: 'Code block' })).toBeNull();
    fireEvent.click(within(document.body).getByRole('menuitem', { name: 'Insert' }));
    expect(
      within(document.body).getByRole('menuitem', { name: 'Insert paragraph below' })
        .getAttribute('aria-disabled')
    ).toBe('true');
    expect(props.submissionField.value).toBe(sourceValue);
    expect(view.getByRole('button', { name: 'Undo' }).hasAttribute('disabled')).toBe(true);
    expect(props.onFailure).not.toHaveBeenCalled();
    view.unmount();
  });

  it('keeps the generic menu for a real code-plus-paragraph selection', async () => {
    const props = fixture();
    const sourceValue = '```js\nconst value = 1;\n```\n\nTail';
    props.submissionField.value = sourceValue;
    props.submissionField.defaultValue = sourceValue;
    props.submissionField.setSelectionRange(0, sourceValue.length);
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      Promise.resolve(
        createCodeContentPreviewResponse(
          request,
          sourceValue,
          sourceValue.indexOf('const'),
          'const value = 1;\n'
        )
      )
    );
    const view = render(
      <EditorRoot
        {...props}
        editorBlockIndexPort={sourceLinkBlockIndexPort()}
      />
    );
    const source = await waitFor(() => {
      const element = view.container.querySelector<HTMLElement>('.cm-content');
      if (!element) throw new Error('source-surface-missing');
      return element;
    });

    layoutContextMenuSurface(source);
    fireEvent.contextMenu(source, { clientX: 20, clientY: 24 });
    await within(document.body).findByRole('menu');
    await waitFor(() =>
      expect(
        within(document.body).queryByRole('menuitem', { name: 'Code block' })
      ).toBeNull()
    );
    expect(props.submissionField.value).toBe(sourceValue);
    expect(props.onFailure).not.toHaveBeenCalled();
    view.unmount();
  });

  it.each(['rejected', 'pending'] as const)(
    'opens generic Copy/Cut for a mixed code selection without a %s code query',
    async (queryOutcome) => {
      const props = fixture();
      const sourceValue = '```js\nconst value = 1;\n```\n\nTail';
      props.submissionField.value = sourceValue;
      props.submissionField.defaultValue = sourceValue;
      props.submissionField.setSelectionRange(0, sourceValue.length);
      const pendingCodeRender = deferred<PreviewResponse>();
      const codeRender = vi.fn(() => queryOutcome === 'rejected'
        ? Promise.reject(new Error('code-render-rejected'))
        : pendingCodeRender.promise);
      const renderPreview = vi.mocked(props.previewPort.render).getMockImplementation();
      if (!renderPreview) throw new Error('preview-render-fixture-missing');
      vi.mocked(props.previewPort.render).mockImplementation((request, signal) =>
        request.signature.startsWith('editor-code-content:')
          ? codeRender()
          : renderPreview(request, signal)
      );
      const view = render(
        <EditorRoot
          {...props}
          editorBlockIndexPort={sourceLinkBlockIndexPort()}
        />
      );
      const source = await waitFor(() => {
        const element = view.container.querySelector<HTMLElement>('.cm-content');
        if (!element) throw new Error('source-surface-missing');
        return element;
      });

      layoutContextMenuSurface(source);
      fireEvent.contextMenu(source, { clientX: 20, clientY: 24 });
      const menu = await within(document.body).findByRole('menu');
      for (const name of ['Copy', 'Cut']) {
        expect(within(menu).getByRole('menuitem', { name }).getAttribute('aria-disabled'))
          .toBe('false');
      }
      expect(within(menu).queryByRole('menuitem', { name: 'Code block' })).toBeNull();
      expect(codeRender).not.toHaveBeenCalled();
      expect(props.submissionField.value).toBe(sourceValue);
      expect(props.onFailure).not.toHaveBeenCalled();
      view.unmount();
    }
  );

  it('accepts an exact code-block end boundary for a code action', async () => {
    const props = fixture();
    const sourceValue = '```js\nconst value = 1;\n```\n\nTail';
    const codeEnd = sourceValue.indexOf('\n\nTail');
    props.submissionField.value = sourceValue;
    props.submissionField.defaultValue = sourceValue;
    props.submissionField.setSelectionRange(0, codeEnd);
    const view = render(<EditorRoot {...props} />);
    const source = await waitFor(() => {
      const element = view.container.querySelector<HTMLElement>('.cm-content');
      if (!element) throw new Error('source-surface-missing');
      return element;
    });

    layoutContextMenuSurface(source);
    fireEvent.contextMenu(source, { clientX: 20, clientY: 24 });
    const codeBlock = await within(document.body).findByRole('menuitem', {
      name: 'Code block'
    });
    fireEvent.mouseEnter(codeBlock);
    const remove = await within(document.body).findByRole('menuitem', {
      name: 'Delete code block'
    });
    expect(remove.getAttribute('aria-disabled')).toBe('false');
    fireEvent.click(remove);

    await waitFor(() => expect(props.submissionField.value).toBe('\n\nTail'));
    expect(props.onFailure).not.toHaveBeenCalled();
    view.unmount();
  });

  it('ignores a late code-content clipboard result after the source becomes stale', async () => {
    const props = fixture();
    const sourceValue = '```\nconst value = 1;\n```';
    const codePosition = sourceValue.indexOf('const value');
    const pending = deferred<{ status: 'failed'; code: 'editor-clipboard-write-failed' }>();
    props.submissionField.value = sourceValue;
    props.submissionField.defaultValue = sourceValue;
    props.submissionField.setSelectionRange(codePosition, codePosition);
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      Promise.resolve(
        createCodeContentPreviewResponse(
          request,
          sourceValue,
          codePosition,
          'const value = 1;\n'
        )
      )
    );
    const clipboard = props.editorClipboardPort;
    if (!clipboard) throw new Error('clipboard-write-owner-missing');
    vi.mocked(clipboard.write).mockReturnValue(pending.promise);
    const view = render(<EditorRoot {...props} />);
    const source = await waitFor(() => {
      const element = view.container.querySelector<HTMLElement>('.cm-content');
      if (!element) throw new Error('source-surface-missing');
      return element;
    });

    layoutContextMenuSurface(source);
    fireEvent.contextMenu(source, { clientX: 20, clientY: 24 });
    fireEvent.mouseEnter(await within(document.body).findByRole('menuitem', {
      name: 'Code block'
    }));
    fireEvent.click(await within(document.body).findByRole('menuitem', {
      name: 'Copy Code Block Content'
    }));
    await waitFor(() => expect(clipboard.write).toHaveBeenCalledWith(
      'const value = 1;\n',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    ));

    const editor = EditorView.findFromDOM(source);
    if (!editor) throw new Error('source-editor-missing');
    editor.dispatch({
      changes: { from: sourceValue.length, insert: 'x', to: sourceValue.length }
    });
    pending.resolve({ code: 'editor-clipboard-write-failed', status: 'failed' });
    await Promise.resolve();
    expect(props.onFailure).not.toHaveBeenCalled();
    expect(editor.state.doc.toString()).toBe(`${sourceValue}x`);
    view.unmount();
  });

  it('indents an official JavaScript code block through one canonical edit', async () => {
    const props = fixture();
    const sourceValue = '```js\nfunction run() {\nreturn 1;\n}\n```';
    const codePosition = sourceValue.indexOf('return');
    props.submissionField.value = sourceValue;
    props.submissionField.defaultValue = sourceValue;
    props.submissionField.setSelectionRange(codePosition, codePosition);
    vi.mocked(props.previewPort.render).mockImplementation((request) => {
      const candidate = request.signature.startsWith(
        'editor-code-indent-candidate:'
      );
      return Promise.resolve(
        createCodeIndentationPreviewResponse(
          request,
          candidate ? request.markdown : sourceValue,
          candidate
            ? 'function run() {\n  return 1;\n}\n'
            : 'function run() {\nreturn 1;\n}\n'
        )
      );
    });
    const view = render(<EditorRoot {...props} />);
    const source = await waitFor(() => {
      const element = view.container.querySelector<HTMLElement>('.cm-content');
      if (!element) throw new Error('source-surface-missing');
      return element;
    });
    const editor = EditorView.findFromDOM(source);
    if (!editor) throw new Error('source-editor-missing');

    layoutContextMenuSurface(source);
    fireEvent.contextMenu(source, { clientX: 20, clientY: 24 });
    const codeBlock = await within(document.body).findByRole('menuitem', {
      name: 'Code block'
    });
    fireEvent.mouseEnter(codeBlock);
    const indent = await within(document.body).findByRole('menuitem', {
      name: 'Adjust Code Block Indentation'
    });
    expect(indent.getAttribute('aria-disabled')).toBe('false');
    expect(
      (await within(document.body).findByRole('menuitem', {
        name: 'Adjust Selected Code Indentation'
      })).getAttribute('aria-disabled')
    ).toBe('true');
    fireEvent.click(indent);

    const expected = '```js\nfunction run() {\n  return 1;\n}\n```';
    await waitFor(() => expect(editor.state.doc.toString()).toBe(expected));
    expect(props.submissionField.value).toBe(expected);
    expect(props.onFailure).not.toHaveBeenCalled();
    fireEvent.click(view.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(editor.state.doc.toString()).toBe(sourceValue));
    view.unmount();
  });

  it('keeps an already-indented JavaScript block as a canonical no-op', async () => {
    const props = fixture();
    const sourceValue = '```js\nfunction run() {\n  return 1;\n}\n```';
    const codePosition = sourceValue.indexOf('return');
    props.submissionField.value = sourceValue;
    props.submissionField.defaultValue = sourceValue;
    props.submissionField.setSelectionRange(codePosition, codePosition);
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      Promise.resolve(
        createCodeIndentationPreviewResponse(
          request,
          request.signature.startsWith('editor-code-indent-candidate:')
            ? request.markdown
            : sourceValue,
          'function run() {\n  return 1;\n}\n'
        )
      )
    );
    const view = render(<EditorRoot {...props} />);
    const source = await waitFor(() => {
      const element = view.container.querySelector<HTMLElement>('.cm-content');
      if (!element) throw new Error('source-surface-missing');
      return element;
    });
    const editor = EditorView.findFromDOM(source);
    if (!editor) throw new Error('source-editor-missing');
    layoutContextMenuSurface(source);
    fireEvent.contextMenu(source, { clientX: 20, clientY: 24 });
    fireEvent.mouseEnter(await within(document.body).findByRole('menuitem', {
      name: 'Code block'
    }));
    fireEvent.click(await within(document.body).findByRole('menuitem', {
      name: 'Adjust Code Block Indentation'
    }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(editor.state.doc.toString()).toBe(sourceValue);
    expect(props.submissionField.value).toBe(sourceValue);
    expect(props.onFailure).not.toHaveBeenCalled();
    expect(view.getByRole('button', { name: 'Undo' }).hasAttribute('disabled')).toBe(true);
    expect(
      vi.mocked(props.previewPort.render).mock.calls.some(([request]) =>
        request.signature.startsWith('editor-code-indent-candidate:')
      )
    ).toBe(false);
    view.unmount();
  });

  it('routes ordinary fenced code block copy through the code owner', async () => {
    const props = fixture();
    const sourceValue = '```js\nconst value = 1;\n```';
    const codePosition = sourceValue.indexOf('value');
    props.submissionField.value = sourceValue;
    props.submissionField.defaultValue = sourceValue;
    props.submissionField.setSelectionRange(codePosition, codePosition);

    const view = render(<EditorRoot {...props} />);
    const source = await waitFor(() => {
      const element = view.container.querySelector<HTMLElement>('.cm-content');
      if (!element) throw new Error('source-surface-missing');
      return element;
    });

    layoutContextMenuSurface(source);
    fireEvent.contextMenu(source, { clientX: 20, clientY: 24 });
    fireEvent.mouseEnter(await within(document.body).findByRole('menuitem', {
      name: 'Code block'
    }));
    fireEvent.click(await within(document.body).findByRole('menuitem', {
      name: 'Copy code block'
    }));

    await waitFor(() =>
      expect(props.editorClipboardPort?.write).toHaveBeenCalledWith(sourceValue)
    );
    expect(props.submissionField.value).toBe(sourceValue);
    expect(props.onFailure).not.toHaveBeenCalled();
    view.unmount();
  });

  it('keeps code-block common actions grouped without duplicating root actions', async () => {
    const props = fixture();
    const sourceValue = '```js\nconst value = 1;\n```';
    const codePosition = sourceValue.indexOf('value');
    props.submissionField.value = sourceValue;
    props.submissionField.defaultValue = sourceValue;
    props.submissionField.setSelectionRange(codePosition, codePosition);

    const view = render(<EditorRoot {...props} />);
    const source = await waitFor(() => {
      const element = view.container.querySelector<HTMLElement>('.cm-content');
      if (!element) throw new Error('source-surface-missing');
      return element;
    });

    layoutContextMenuSurface(source);
    fireEvent.contextMenu(source, { clientX: 20, clientY: 24 });
    const codeTrigger = await within(document.body).findByRole('menuitem', {
      name: 'Code block'
    });
    fireEvent.mouseEnter(codeTrigger);
    const codeMenu = await within(document.body).findByRole('menu', {
      name: 'Code block'
    });

    const bold = within(codeMenu).getByRole('menuitem', { name: /^Bold/ });
    expect(bold.getAttribute('aria-disabled')).toBe('true');
    expect(within(codeMenu).getByRole('menuitem', { name: 'Delete code block' })).toBeTruthy();
    expect(within(codeMenu).getByRole('menuitem', { name: 'Copy / Paste as' })).toBeTruthy();
    expect(within(codeMenu).getByRole('menuitem', { name: 'Insert' })).toBeTruthy();
    expect(within(document.body).queryAllByRole('menuitem', { name: /^Bold/ })).toHaveLength(1);
    expect(within(document.body).queryAllByRole('menuitem', { name: 'Copy / Paste as' })).toHaveLength(1);
    expect(within(document.body).queryAllByRole('menuitem', { name: 'Insert' })).toHaveLength(1);

    fireEvent.mouseEnter(within(codeMenu).getByRole('menuitem', { name: 'Copy / Paste as' }));
    const copyPasteMenu = await within(document.body).findByRole('menu', {
      name: 'Copy / Paste as'
    });
    expect(within(copyPasteMenu).getByRole('menuitem', { name: 'Copy as HTML code' })).toBeTruthy();
    expect(within(copyPasteMenu).getByRole('menuitem', { name: 'Copy with simplified formatting' })).toBeTruthy();

    fireEvent.mouseEnter(within(codeMenu).getByRole('menuitem', { name: 'Insert' }));
    const insertMenu = await within(document.body).findByRole('menu', {
      name: 'Insert'
    });
    expect(within(insertMenu).getByRole('menuitem', { name: 'Insert table above' })).toBeTruthy();
    expect(within(insertMenu).getByRole('menuitem', { name: 'Insert table below' })).toBeTruthy();
    expect(within(insertMenu).getByRole('menuitem', { name: 'Insert image above' })).toBeTruthy();
    expect(within(insertMenu).getByRole('menuitem', { name: 'Insert image below' })).toBeTruthy();
    expect(props.onFailure).not.toHaveBeenCalled();
    view.unmount();
  });

  it.each([
    {
      name: 'quote',
      relative: 'above',
      source: ['> ```js', '> code', '> ```', '> tail'].join('\n'),
      expected: ['> ', '> ```js', '> code', '> ```', '> tail'].join('\n')
    },
    {
      name: 'list',
      relative: 'below',
      source: ['- ```js', '  code', '  ```', '- tail'].join('\n'),
      expected: ['- ```js', '  code', '  ```', '  ', '- tail'].join('\n')
    }
  ])(
    'keeps code-relative paragraph insertion inside a nested $name container',
    async ({ relative, source, expected }) => {
      const props = fixture();
      const codePosition = source.indexOf('code');
      props.submissionField.value = source;
      props.submissionField.defaultValue = source;
      props.submissionField.setSelectionRange(codePosition, codePosition);
      vi.mocked(props.previewPort.render).mockImplementation((request) => {
        const target = observedCodeContentTarget(
          source,
          { end: codePosition, start: codePosition },
          observedBlockIndex(source)
        );
        if ('unavailable' === target.status) {
          throw new Error(target.code);
        }
        return Promise.resolve({
          ...createPreviewResponse(request, '<p>Rendered</p>' as SafePreviewHtml, {}),
          codeMap: {
            coordinate: 'line' as const,
            entries: [{
              content: 'code\n',
              endLine: target.target.lineEnd,
              kind: target.target.kind,
              startLine: target.target.lineStart,
              status: 'available' as const
            }],
            signature: request.signature,
            status: 'available' as const,
            version: 1 as const
          }
        });
      });

      const view = render(
        <EditorRoot
          {...props}
          editorBlockIndexPort={sourceLinkBlockIndexPort()}
        />
      );
      const sourceSurface = await waitFor(() => {
        const element = view.container.querySelector<HTMLElement>('.cm-content');
        if (!element) throw new Error('source-surface-missing');
        return element;
      });
      layoutContextMenuSurface(sourceSurface);
      fireEvent.contextMenu(sourceSurface, { clientX: 20, clientY: 24 });
      fireEvent.mouseEnter(await within(document.body).findByRole('menuitem', {
        name: 'Code block'
      }));
      const action = await within(document.body).findByRole('menuitem', {
        name: 'above' === relative
          ? 'Insert paragraph above code block'
          : 'Insert paragraph below code block'
      });
      expect(action.getAttribute('aria-disabled')).toBe('false');
      fireEvent.click(action);

      await waitFor(() => expect(props.submissionField.value).toBe(expected));
      expect(props.submissionField.value).not.toBe(
        'above' === relative
          ? `\n${source}`
          : `${source}\n`
      );
      expect(props.onFailure).not.toHaveBeenCalled();
      view.unmount();
    }
  );

  it('rejects a stale indentation candidate before the canonical write', async () => {
    const props = fixture();
    const sourceValue = '```js\nfunction run() {\nreturn 1;\n}\n```';
    const codePosition = sourceValue.indexOf('return');
    const candidateRequestHolder: { current: PreviewRequest | null } = {
      current: null
    };
    props.submissionField.value = sourceValue;
    props.submissionField.defaultValue = sourceValue;
    props.submissionField.setSelectionRange(codePosition, codePosition);
    vi.mocked(props.previewPort.render).mockImplementation((request) => {
      if (request.signature.startsWith('editor-code-indent-candidate:')) {
        candidateRequestHolder.current = request;
        const response = createCodeIndentationPreviewResponse(
          request,
          request.markdown,
          'function run() {\n  return 1;\n}\n'
        );
        const projection = response.codeProjection;
        if (!projection || 'unavailable' === projection.status) {
          throw new Error('candidate-projection-fixture-missing');
        }
        return Promise.resolve({
          ...response,
          codeProjection: { ...projection, signature: 'stale-candidate' }
        });
      }
      if (request.signature.startsWith('editor-code-content:')) {
        return Promise.resolve(
          createCodeIndentationPreviewResponse(
            request,
            sourceValue,
            'function run() {\nreturn 1;\n}\n'
          )
        );
      }
      return Promise.resolve(
        createPreviewResponse(request, '<p>Rendered</p>' as SafePreviewHtml, {})
      );
    });
    const view = render(<EditorRoot {...props} />);
    const source = await waitFor(() => {
      const element = view.container.querySelector<HTMLElement>('.cm-content');
      if (!element) throw new Error('source-surface-missing');
      return element;
    });
    const editor = EditorView.findFromDOM(source);
    if (!editor) throw new Error('source-editor-missing');
    layoutContextMenuSurface(source);
    fireEvent.contextMenu(source, { clientX: 20, clientY: 24 });
    fireEvent.mouseEnter(await within(document.body).findByRole('menuitem', {
      name: 'Code block'
    }));
    fireEvent.click(await within(document.body).findByRole('menuitem', {
      name: 'Adjust Code Block Indentation'
    }));
    await waitFor(() => expect(props.onFailure).toHaveBeenCalledWith(
      'editor-code-projection-candidate-stale'
    ));
    expect(candidateRequestHolder.current?.markdown).toBe(
      '```js\nfunction run() {\n  return 1;\n}\n```'
    );
    expect(editor.state.doc.toString()).toBe(sourceValue);
    expect(props.submissionField.value).toBe(sourceValue);
    expect(view.getByRole('button', { name: 'Undo' }).hasAttribute('disabled')).toBe(true);
    view.unmount();
  });

  it('reports a candidate Preview transport failure without a canonical write', async () => {
    const props = fixture();
    const sourceValue = '```js\nfunction run() {\nreturn 1;\n}\n```';
    const codePosition = sourceValue.indexOf('return');
    props.submissionField.value = sourceValue;
    props.submissionField.defaultValue = sourceValue;
    props.submissionField.setSelectionRange(codePosition, codePosition);
    vi.mocked(props.previewPort.render).mockImplementation((request) => {
      if (request.signature.startsWith('editor-code-indent-candidate:')) {
        return Promise.reject(new Error('candidate-preview-failed'));
      }
      if (request.signature.startsWith('editor-code-content:')) {
        return Promise.resolve(
          createCodeIndentationPreviewResponse(
            request,
            sourceValue,
            'function run() {\nreturn 1;\n}\n'
          )
        );
      }
      return Promise.resolve(
        createPreviewResponse(request, '<p>Rendered</p>' as SafePreviewHtml, {})
      );
    });
    const view = render(<EditorRoot {...props} />);
    const source = await waitFor(() => {
      const element = view.container.querySelector<HTMLElement>('.cm-content');
      if (!element) throw new Error('source-surface-missing');
      return element;
    });
    const editor = EditorView.findFromDOM(source);
    if (!editor) throw new Error('source-editor-missing');
    layoutContextMenuSurface(source);
    fireEvent.contextMenu(source, { clientX: 20, clientY: 24 });
    fireEvent.mouseEnter(await within(document.body).findByRole('menuitem', {
      name: 'Code block'
    }));
    fireEvent.click(await within(document.body).findByRole('menuitem', {
      name: 'Adjust Code Block Indentation'
    }));
    await waitFor(() => expect(props.onFailure).toHaveBeenCalledWith(
      'editor-code-projection-candidate-unavailable'
    ));
    expect(editor.state.doc.toString()).toBe(sourceValue);
    expect(props.submissionField.value).toBe(sourceValue);
    expect(view.getByRole('button', { name: 'Undo' }).hasAttribute('disabled')).toBe(true);
    view.unmount();
  });

  it('rejects a late indentation candidate after the source becomes stale', async () => {
    const props = fixture();
    const sourceValue = '```js\nfunction run() {\nreturn 1;\n}\n```';
    const codePosition = sourceValue.indexOf('return');
    const pending = deferred<PreviewResponse>();
    const candidateRequestHolder: { current: PreviewRequest | null } = {
      current: null
    };
    props.submissionField.value = sourceValue;
    props.submissionField.defaultValue = sourceValue;
    props.submissionField.setSelectionRange(codePosition, codePosition);
    vi.mocked(props.previewPort.render).mockImplementation((request) => {
      if (request.signature.startsWith('editor-code-indent-candidate:')) {
        candidateRequestHolder.current = request;
        return pending.promise;
      }
      if (request.signature.startsWith('editor-code-content:')) {
        return Promise.resolve(
          createCodeIndentationPreviewResponse(
            request,
            sourceValue,
            'function run() {\nreturn 1;\n}\n'
          )
        );
      }
      return Promise.resolve(
        createPreviewResponse(request, '<p>Rendered</p>' as SafePreviewHtml, {})
      );
    });
    const view = render(<EditorRoot {...props} />);
    const source = await waitFor(() => {
      const element = view.container.querySelector<HTMLElement>('.cm-content');
      if (!element) throw new Error('source-surface-missing');
      return element;
    });
    const editor = EditorView.findFromDOM(source);
    if (!editor) throw new Error('source-editor-missing');
    layoutContextMenuSurface(source);
    fireEvent.contextMenu(source, { clientX: 20, clientY: 24 });
    fireEvent.mouseEnter(await within(document.body).findByRole('menuitem', {
      name: 'Code block'
    }));
    fireEvent.click(await within(document.body).findByRole('menuitem', {
      name: 'Adjust Code Block Indentation'
    }));
    await waitFor(() => expect(candidateRequestHolder.current).not.toBeNull());
    editor.dispatch({
      changes: { from: sourceValue.length, insert: 'x', to: sourceValue.length }
    });
    const candidateRequest = candidateRequestHolder.current;
    if (!candidateRequest) throw new Error('candidate-request-missing');
    pending.resolve(
      createCodeIndentationPreviewResponse(
        candidateRequest,
        candidateRequest.markdown,
        'function run() {\n  return 1;\n}\n'
      )
    );
    await waitFor(() => expect(props.onFailure).toHaveBeenCalledWith(
      'editor-code-projection-candidate-stale'
    ));
    expect(editor.state.doc.toString()).toBe(`${sourceValue}x`);
    expect(props.submissionField.value).toBe(`${sourceValue}x`);
    expect(view.getByRole('button', { name: 'Undo' }).hasAttribute('disabled')).toBe(false);
    fireEvent.click(view.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(editor.state.doc.toString()).toBe(sourceValue));
    view.unmount();
  });

  it('ignores an indentation response after the source becomes stale', async () => {
    const props = fixture();
    const sourceValue = '```js\nfunction run() {\nreturn 1;\n}\n```';
    const pending = deferred<PreviewResponse>();
    let codeRequest: PreviewRequest | null = null;
    props.submissionField.value = sourceValue;
    props.submissionField.defaultValue = sourceValue;
    props.submissionField.setSelectionRange(sourceValue.indexOf('return'), sourceValue.indexOf('return'));
    vi.mocked(props.previewPort.render).mockImplementation((request) => {
      if (request.signature.startsWith('editor-code-content:')) {
        codeRequest = request;
        return pending.promise;
      }
      return Promise.resolve(createPreviewResponse(
        request,
        '<p>Rendered</p>' as SafePreviewHtml,
        {}
      ));
    });
    const view = render(<EditorRoot {...props} />);
    const source = await waitFor(() => {
      const element = view.container.querySelector<HTMLElement>('.cm-content');
      if (!element) throw new Error('source-surface-missing');
      return element;
    });
    const editor = EditorView.findFromDOM(source);
    if (!editor) throw new Error('source-editor-missing');
    layoutContextMenuSurface(source);
    fireEvent.contextMenu(source, { clientX: 20, clientY: 24 });
    await waitFor(() => expect(codeRequest).not.toBeNull());
    editor.dispatch({
      changes: { from: sourceValue.length, insert: 'x', to: sourceValue.length }
    });
    if (!codeRequest) throw new Error('code-content-request-missing');
    pending.resolve(
      createCodeIndentationPreviewResponse(
        codeRequest,
        sourceValue,
        'function run() {\nreturn 1;\n}\n'
      )
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(editor.state.doc.toString()).toBe(`${sourceValue}x`);
    expect(props.onFailure).not.toHaveBeenCalled();
    expect(within(document.body).queryByRole('menu')).toBeNull();
    view.unmount();
  });

  it.each([
    [
      'partial caption',
      'Before [caption](https://source.test) after',
      'caption',
      3
    ],
    [
      'reference use-site',
      '[标题][引用]\n\n[引用]: https://source.test/reference',
      '标题',
      1
    ]
  ])(
    'resolves Source %s links through the authoritative Preview href',
    async (_label, sourceValue, selectedText, selectionOffset) => {
      const props = fixture();
      const selectedStart = sourceValue.indexOf(selectedText) + selectionOffset;
      props.submissionField.value = sourceValue;
      props.submissionField.defaultValue = sourceValue;
      props.submissionField.setSelectionRange(
        selectedStart,
        selectedStart + selectedText.length - selectionOffset
      );
      const blockIndexPort = sourceLinkBlockIndexPort();
      const previewRender = vi.mocked(props.previewPort.render);
      previewRender.mockImplementation((request) =>
        Promise.resolve(
          createSourceLinkPreviewResponse(
            request,
            'https://actual.test/resolved'
          )
        )
      );
      const view = render(
        <EditorRoot
          {...props}
          editorBlockIndexPort={blockIndexPort}
          simplifiedFormattingParser={sourceLinkParser()}
        />
      );
      const source = await waitFor(() => {
        const element = view.container.querySelector<HTMLElement>('.cm-content');
        if (!element) throw new Error('source-surface-missing');
        return element;
      });

      layoutContextMenuSurface(source);
      fireEvent.contextMenu(source, { clientX: 20, clientY: 24 });
      const copyAddress = await within(document.body).findByRole('menuitem', {
        name: 'Copy link address'
      });
      expect(
        within(document.body).queryByRole('menuitem', { name: 'Open link' })
      ).toBeNull();
      expect(copyAddress.getAttribute('aria-disabled')).toBe('false');
      fireEvent.click(copyAddress);
      await waitFor(() =>
        expect(props.editorClipboardPort?.write).toHaveBeenCalledWith(
          'https://actual.test/resolved'
        )
      );
      expect(props.submissionField.value).toBe(sourceValue);
      expect(props.onFailure).not.toHaveBeenCalled();
      expect(
        previewRender.mock.calls.some(([request]) =>
          request.signature.startsWith('editor-source-link:')
        )
      ).toBe(true);
      view.unmount();
    }
  );

  it('reports a Source link Preview anchor failure without enabling link actions', async () => {
    const props = fixture();
    const sourceValue = '[caption](https://source.test)';
    const selectionStart = sourceValue.indexOf('caption') + 1;
    props.submissionField.value = sourceValue;
    props.submissionField.defaultValue = sourceValue;
    props.submissionField.setSelectionRange(selectionStart, selectionStart + 2);
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      Promise.resolve(createSourceLinkPreviewResponse(
        request,
        'https://actual.test/resolved',
        false
      ))
    );
    const view = render(
      <EditorRoot
        {...props}
        editorBlockIndexPort={sourceLinkBlockIndexPort()}
        simplifiedFormattingParser={sourceLinkParser()}
      />
    );
    const source = await waitFor(() => {
      const element = view.container.querySelector<HTMLElement>('.cm-content');
      if (!element) throw new Error('source-surface-missing');
      return element;
    });
    layoutContextMenuSurface(source);
    fireEvent.contextMenu(source, { clientX: 20, clientY: 24 });
    await waitFor(() => expect(props.onFailure).toHaveBeenCalledWith(
      'editor-source-link-preview-anchor-missing'
    ));
    expect(
      within(document.body).queryByRole('menuitem', {
        name: 'Copy link address'
      })
    ).toBeNull();
    expect(props.submissionField.value).toBe(sourceValue);
    view.unmount();
  });

  it('ignores a late Source link response after the canonical document changes', async () => {
    const props = fixture();
    const sourceValue = '[caption](https://source.test)';
    const selectionStart = sourceValue.indexOf('caption') + 1;
    const pending = deferred<PreviewResponse>();
    let linkRequest: PreviewRequest | null = null;
    props.submissionField.value = sourceValue;
    props.submissionField.defaultValue = sourceValue;
    props.submissionField.setSelectionRange(selectionStart, selectionStart + 2);
    vi.mocked(props.previewPort.render).mockImplementation((request) => {
      if (request.signature.startsWith('editor-source-link:')) {
        linkRequest = request;
        return pending.promise;
      }
      return Promise.resolve(createPreviewResponse(
        request,
        '<p>Rendered</p>' as SafePreviewHtml,
        {}
      ));
    });
    const view = render(
      <EditorRoot
        {...props}
        editorBlockIndexPort={sourceLinkBlockIndexPort()}
        simplifiedFormattingParser={sourceLinkParser()}
      />
    );
    const source = await waitFor(() => {
      const element = view.container.querySelector<HTMLElement>('.cm-content');
      if (!element) throw new Error('source-surface-missing');
      return element;
    });
    layoutContextMenuSurface(source);
    fireEvent.contextMenu(source, { clientX: 20, clientY: 24 });
    await waitFor(() => expect(linkRequest).not.toBeNull());

    const editor = EditorView.findFromDOM(source);
    if (!editor) throw new Error('source-editor-missing');
    editor.dispatch({
      changes: { from: sourceValue.length, insert: 'x', to: sourceValue.length }
    });
    if (!linkRequest) throw new Error('source-link-request-missing');
    pending.resolve(
      createSourceLinkPreviewResponse(
        linkRequest,
        'https://actual.test/resolved'
      )
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(props.onFailure).not.toHaveBeenCalled();
    expect(within(document.body).queryByRole('menu')).toBeNull();
    expect(editor.state.doc.toString()).toBe(`${sourceValue}x`);
    view.unmount();
  });

  it.each([
    [
      'https://example.test/imported.png',
      '![alt](https://example.test/imported.png "title")'
    ],
    [
      'https://example.test/original.png',
      '![alt](https://example.test/original.png "title")'
    ]
  ])(
    'replaces only an eligible image destination after authoritative upload (%s)',
    async (uploadedUrl, expected) => {
      const props = fixture();
      const initial = '![alt](https://example.test/original.png "title")';
      props.submissionField.value = initial;
      props.submissionField.defaultValue = initial;
      props.submissionField.setSelectionRange(0, initial.length);
      vi.mocked(props.remoteImageImportPort.import).mockResolvedValue(
        uploadedUrl === 'https://example.test/original.png'
          ? {
              alt: 'remote image',
              status: 'unchanged',
              title: 'title',
              url: uploadedUrl
            }
          : {
              alt: 'remote image',
              backup: { status: 'disabled' },
              status: 'imported',
              title: 'title',
              url: uploadedUrl
            }
      );
      const editorBlockIndexPort = imageBlockIndexPort();
      const view = render(
        <EditorRoot {...props} editorBlockIndexPort={editorBlockIndexPort} />
      );
      const source = await waitFor(() => {
        const element =
          view.container.querySelector<HTMLElement>('.cm-content');
        if (!element) throw new Error('source-surface-missing');
        return element;
      });
      layoutContextMenuSurface(source);
      fireEvent.contextMenu(source, { clientX: 20, clientY: 24 });
      await waitFor(() =>
        expect(editorBlockIndexPort.build).toHaveBeenCalled()
      );
      await within(document.body).findByRole('menu');
      fireEvent.click(
        within(document.body).getByRole('menuitem', { name: 'Upload image' })
      );
      await waitFor(() =>
        expect(props.remoteImageImportPort.import).toHaveBeenCalledOnce()
      );
      await waitFor(() => expect(props.submissionField.value).toBe(expected));
      view.unmount();
    }
  );

  it.each([
    [true, false, true, false, true],
    [true, false, false, true, true],
    [false, true, true, false, true],
    [false, true, false, true, true],
    [false, false, true, false, false],
    [false, false, false, true, false],
    [false, false, false, false, false]
  ])(
    'selects the correct visual owner for needsWindow=%s historyPending=%s editing=%s requested=%s',
    (needsWindow, historyPending, editing, requested, expected) => {
      expect(
        visualPreviewUsesWindowedOwner(
          needsWindow,
          historyPending,
          editing,
          requested
        )
      ).toBe(expected);
    }
  );

  it.each([
    [false, false, true, true],
    [true, true, true, true],
    [true, false, false, true],
    [false, true, true, false],
    [false, false, false, false]
  ])(
    'retains a windowed Preview while its surface is hidden',
    (currentWindowed, previewVisible, needsWindow, expected) => {
      expect(
        visualPreviewSurfaceWindowedForVisibility(
          currentWindowed,
          previewVisible,
          needsWindow
        )
      ).toBe(expected);
    }
  );

  it.each([
    [false, true, false, true, false, true],
    [false, false, true, true, false, true],
    [false, false, false, true, false, false],
    [false, true, false, false, false, false],
    [true, false, false, false, true, true]
  ])(
    'keeps the Preview surface Windowed for history and ordinary pending owners',
    (needsWindow, historyOwnerPending, previewPending, editing, requested, expected) => {
      expect(
        visualPreviewSurfaceUsesWindowedOwner(
          needsWindow,
          historyOwnerPending,
          previewPending,
          editing,
          requested
        )
      ).toBe(expected);
    }
  );

  it.each([
    ['', true],
    [' ', true],
    ['\n\n', true],
    ['Before', false]
  ])(
    'admits only empty or terminal-whitespace Preview sources without an edit map',
    (sourceMarkdown, expected) => {
      expect(
        visualPreviewSourceHasEditableMap({ editMap: null }, sourceMarkdown)
      ).toBe(expected);
    }
  );

  it('keeps the Windowed history branch when a same-turn document-end lease is acquired', () => {
    let documentEndHistoryPending = false;
    let redoDepth = 0;
    const queued: Array<() => void> = [];
    const release = vi.fn();
    const enqueue = (callback: () => void) => queued.push(callback);
    const scheduleRelease = () =>
      scheduleVisualWindowedHistoryBranchRelease(
        () => documentEndHistoryPending,
        () => redoDepth > 0,
        release,
        enqueue
      );

    scheduleRelease();
    expect(release).not.toHaveBeenCalled();
    documentEndHistoryPending = true;
    queued.shift()?.();
    expect(release).not.toHaveBeenCalled();
    expect(
      visualPreviewUsesWindowedOwner(
        false,
        documentEndHistoryPending,
        true,
        false
      )
    ).toBe(true);

    documentEndHistoryPending = false;
    redoDepth = 1;
    scheduleRelease();
    queued.shift()?.();
    expect(release).not.toHaveBeenCalled();

    redoDepth = 0;
    scheduleRelease();
    queued.shift()?.();
    expect(release).toHaveBeenCalledOnce();
  });

  it('acquires the exact Preview pin before scheduling and releases it when scheduling throws', () => {
    const previewRequest: PreviewRequest = {
      codeTheme: 'dark',
      customCssId: '',
      markdown: 'EOF',
      markdownTheme: 'default',
      postId: 7,
      signature: '42:3'
    };
    const operations: string[] = [];
    const release = vi.fn(() => operations.push('release'));
    const selectionRestored = vi.fn(() =>
      operations.push('selection-restored')
    );
    const schedule = vi.fn((request: PreviewRequest, immediate?: boolean) => {
      operations.push(`schedule:${request.signature}:${String(immediate)}`);
      return 9;
    });
    const runtime = {
      prepareDocumentEndWindowPin: vi.fn((signature: string) => {
        operations.push(`pin:${signature}`);
        return { release };
      }),
      session: {
        destroy: vi.fn(),
        isCurrent: vi.fn(() => true),
        schedule
      }
    };

    const historyPending: boolean[] = [];
    const lease = schedulePreviewWithDocumentEndPin(
      runtime,
      previewRequest,
      (pending) => historyPending.push(pending),
      selectionRestored
    );

    expect(operations).toEqual(['pin:42:3', 'schedule:42:3:true']);
    expect(historyPending).toEqual([true]);
    expect(runtime.prepareDocumentEndWindowPin).toHaveBeenCalledOnce();
    expect(schedule).toHaveBeenCalledWith(previewRequest, true);
    expect(lease.signature).toBe(previewRequest.signature);
    lease.onSelectionRestored();
    lease.onSelectionRestored();
    expect(selectionRestored).toHaveBeenCalledOnce();
    lease.release();
    lease.release();
    expect(release).toHaveBeenCalledOnce();
    expect(historyPending).toEqual([true, false]);

    const failedRelease = vi.fn();
    const failedSelectionRestored = vi.fn();
    const failedHistoryPending: boolean[] = [];
    const failedRuntime = {
      prepareDocumentEndWindowPin: vi.fn(() => ({ release: failedRelease })),
      session: {
        destroy: vi.fn(),
        isCurrent: vi.fn(() => true),
        schedule: vi.fn(() => {
          throw new Error('preview-schedule-failed');
        })
      }
    };
    expect(() =>
      schedulePreviewWithDocumentEndPin(
        failedRuntime,
        previewRequest,
        (pending) => failedHistoryPending.push(pending),
        failedSelectionRestored
      )
    ).toThrow('preview-schedule-failed');
    expect(failedRelease).toHaveBeenCalledOnce();
    expect(failedHistoryPending).toEqual([true, false]);
    expect(failedSelectionRestored).not.toHaveBeenCalled();
  });

  it('focuses only the current visual runtime across disposal and replacement', () => {
    const createSurface = () => {
      const surface = document.createElement('div');
      surface.tabIndex = -1;
      surface.setAttribute('contenteditable', 'true');
      Object.defineProperty(surface, 'isContentEditable', { value: true });
      document.body.append(surface);
      return surface;
    };
    const surfaceA = createSurface();
    const surfaceB = createSurface();
    const runtimeA: ImmersiveVisualEditorRuntime = {
      applyCanonicalChange: () => 'blocked',
      executeCommand: () => 'blocked',
      getGeneratedPreviewIdentity: () => null,
      isEditable: () => true,
      prepareGeneratedContentTarget: () => null,
      prepareGeneratedContentTargetForSelection: () => null,
      prepareImageTarget: () => null,
      prepareImageTargetBySelection: () => null,
      prepareMediaSelection: () => false,
      prepareSourceNavigation: () => false,
      prepareToolbarFallback: () => false,
      surface: surfaceA
    };
    const runtimeB: ImmersiveVisualEditorRuntime = {
      applyCanonicalChange: () => 'blocked',
      executeCommand: () => 'blocked',
      getGeneratedPreviewIdentity: () => null,
      isEditable: () => true,
      prepareGeneratedContentTarget: () => null,
      prepareGeneratedContentTargetForSelection: () => null,
      prepareImageTarget: () => null,
      prepareImageTargetBySelection: () => null,
      prepareMediaSelection: () => false,
      prepareSourceNavigation: () => false,
      prepareToolbarFallback: () => false,
      surface: surfaceB
    };
    const neutralControl = document.createElement('button');
    document.body.append(neutralControl);
    const activeElement = () =>
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const onFailure = vi.fn();

    try {
      expect(
        focusVisualPreviewRuntime(runtimeA, activeElement, onFailure)
      ).toBe(true);
      expect(document.activeElement).toBe(surfaceA);

      neutralControl.focus();
      expect(document.activeElement).toBe(neutralControl);

      expect(focusVisualPreviewRuntime(null, activeElement, onFailure)).toBe(
        false
      );
      expect(document.activeElement).toBe(neutralControl);
      expect(onFailure).toHaveBeenLastCalledWith(
        'visual-editor-focus-surface-unavailable'
      );

      expect(
        focusVisualPreviewRuntime(runtimeB, activeElement, onFailure)
      ).toBe(true);
      expect(document.activeElement).toBe(surfaceB);
      expect(onFailure).toHaveBeenCalledOnce();
    } finally {
      neutralControl.remove();
      surfaceA.remove();
      surfaceB.remove();
    }
  });

  it('rejects a queued windowed unlock after its Preview snapshot is superseded', () => {
    const queued = { revision: 3, signature: 'queued-preview' };
    const superseding = { revision: 4, signature: 'new-preview' };

    expect(
      isVisualPreviewWindowRequestCurrent(queued, superseding, 'ready', true)
    ).toBe(false);
  });

  it('rejects a queued windowed unlock after teardown or a late non-ready callback', () => {
    const queued = { revision: 3, signature: 'queued-preview' };

    expect(
      isVisualPreviewWindowRequestCurrent(queued, queued, 'loading', true)
    ).toBe(false);
    expect(
      isVisualPreviewWindowRequestCurrent(queued, queued, 'ready', false)
    ).toBe(false);
    expect(
      isVisualPreviewWindowRequestCurrent(queued, null, 'ready', true)
    ).toBe(false);
  });

  it('focuses new editable posts by default without stealing focus for existing posts', async () => {
    const existingProps = fixture();
    const sentinel = document.createElement('button');
    sentinel.type = 'button';
    sentinel.textContent = 'Focus sentinel';
    document.body.append(sentinel);
    sentinel.focus();
    const existingView = render(<EditorRoot {...existingProps} />);

    expect(document.activeElement).toBe(sentinel);
    existingView.unmount();

    const newProps = { ...fixture(), isNewPost: true };
    sentinel.focus();
    const newView = render(<EditorRoot {...newProps} />);

    await waitFor(() =>
      expect(document.activeElement?.closest('.cm-editor')).not.toBeNull()
    );
    newView.unmount();

    const previewFixture = fixture();
    const previewProps = {
      ...previewFixture,
      isNewPost: true,
      settings: {
        ...previewFixture.settings,
        general: {
          ...previewFixture.settings.general,
          editingMode: 'preview'
        }
      }
    };
    sentinel.focus();
    const previewView = render(<EditorRoot {...previewProps} />);

    expect(document.activeElement).toBe(sentinel);
    previewView.unmount();
    sentinel.remove();
  });

  it('composes source, toolbar and preview under one React owner', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);

    expect(
      view.container.querySelectorAll('[data-easymde-editor-owner="react"]')
    ).toHaveLength(1);
    expect(props.submissionField.hidden).toBe(true);
    expect(props.onDocumentOwnerChange).toHaveBeenCalledWith(true);
    expect(view.container.querySelector('.cm-editor')).not.toBeNull();
    expect(
      view.container.querySelectorAll('.easymde-pane-header')
    ).toHaveLength(0);
    await waitFor(() =>
      expect(props.previewPort.render).toHaveBeenCalledTimes(1)
    );
    await waitFor(() => {
      expect(
        view.container.querySelector('[data-easymde-preview-html-sink="1"]')
          ?.innerHTML
      ).toBe('<p data-easymde-visual-block-id="b0">Rendered</p>');
    });
    expect(props.shortcutBinding.activate).toHaveBeenCalledTimes(1);

    const bold = view.container.querySelector<HTMLButtonElement>(
      '[data-easymde-command="bold"]'
    );
    expect(bold).not.toBeNull();
    await act(async () => {
      fireEvent.click(bold as HTMLButtonElement);
    });
    expect(props.submissionField.value).toBe('**selected**');

    const image = view.container.querySelector<HTMLButtonElement>(
      '[data-easymde-command="image"]'
    );
    expect(image).not.toBeNull();
    await act(async () => {
      fireEvent.click(image as HTMLButtonElement);
    });
    expect(props.mediaPickerFrame?.open).toHaveBeenCalledTimes(1);

    view.unmount();
    expect(props.submissionField.hidden).toBe(false);
    expect(props.onDocumentOwnerChange).toHaveBeenLastCalledWith(false);
    expect(props.shortcutBinding.dispose).toHaveBeenCalledTimes(1);
    expect(props.enhancementPort.dispose).toHaveBeenCalledTimes(1);
  });

  it('adds the immersive entry while leaving publish and revisions with WordPress', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);

    await waitFor(() =>
      expect(view.getByRole('button', { name: 'Bold' })).not.toBeNull()
    );
    const toolbar = view.getByRole('toolbar', { name: 'Markdown toolbar' });
    const labels = Array.from(
      toolbar.querySelectorAll(
        'button[data-easymde-command], .easymde-toolbar-section-secondary > button, '
          + '.easymde-toolbar-section-secondary > .easymde-toolbar-popover-anchor > button'
      )
    ).map((button) => button.getAttribute('aria-label'));

    expect(labels).toEqual([
      'Bold',
      'Image',
      'Copy to WeChat',
      '进入沉浸写作',
      '编辑器设置'
    ]);
    expect(
      toolbar.querySelectorAll(
        '.easymde-toolbar-section-secondary > .easymde-toolbar-divider'
      )
    ).toHaveLength(1);
    expect(view.queryByRole('button', { name: 'History' })).toBeNull();
    expect(view.queryByRole('button', { name: 'Publish' })).toBeNull();
    const immersiveEntry = view.getByRole('button', {
      name: '进入沉浸写作'
    });
    expect(immersiveEntry.getAttribute('aria-pressed')).toBe('false');
    expect(
      immersiveEntry.classList.contains('easymde-toolbar-immersive-toggle')
    ).toBe(true);
    expect(immersiveEntry.firstElementChild?.className).toBe(
      'dashicons dashicons-fullscreen-alt'
    );
  });

  it('formats canonical punctuation tokens in export command titles', async () => {
    const props = fixture();
    const toolbar = {
      ...props.toolbar,
      commands: [
        ...props.toolbar.commands,
        {
          action: 'extensionExport',
          group: 'export',
          icon: 'admin-generic',
          id: 'extension-export',
          label: 'Extension export',
          surface: 'main'
        }
      ],
      shortcuts: {
        ...props.toolbar.shortcuts,
        'extension-export': {
          mac: 'Cmd+Backquote',
          win: 'Ctrl+Backquote'
        }
      }
    };
    const view = render(<EditorRoot {...props} toolbar={toolbar} />);

    const button = await view.findByRole('button', {
      name: 'Extension export'
    });
    expect(button.title).toBe('Extension export (Ctrl+`)');
  });

  it('recomposes the existing source and preview owners in immersive mode', async () => {
    const props = fixture();
    props.submissionField.value = 'Rendered';
    props.submissionField.defaultValue = 'Rendered';
    const view = render(<EditorRoot {...props} />);
    await waitFor(() =>
      expect(view.getByRole('button', { name: '进入沉浸写作' })).not.toBeNull()
    );
    const assertPreviewPaperFrame = (pane: Element | null) => {
      expect(pane).not.toBeNull();
      expect(
        pane?.querySelectorAll(':scope > .easymde-immersive-preview-canvas')
      ).toHaveLength(1);
      expect(
        pane?.querySelectorAll(
          ':scope > .easymde-immersive-preview-canvas > [data-easymde-preview-html-sink]'
        )
      ).toHaveLength(1);
      expect(
        pane?.querySelectorAll(
          ':scope > .easymde-immersive-preview-canvas .easymde-immersive-preview-canvas'
        )
      ).toHaveLength(0);
    };
    assertPreviewPaperFrame(
      view.container.querySelector('.easymde-pane-preview')
    );
    expect(
      view.container.querySelector('.easymde-immersive-preview-page')
    ).toBeNull();

    fireEvent.click(view.getByRole('button', { name: '进入沉浸写作' }));
    expect(view.getByRole('region', { name: '沉浸写作' })).not.toBeNull();
    expect(
      view.container
        .querySelector('.easymde-editor')
        ?.classList.contains('is-immersive-split')
    ).toBe(true);
    expect(
      view.container.querySelectorAll('[data-easymde-document-owner="react"]')
    ).toHaveLength(1);
    expect(
      view.container.querySelectorAll('.easymde-pane-preview')
    ).toHaveLength(1);
    expect(
      view.container.querySelectorAll('.easymde-pane-header')
    ).toHaveLength(2);
    expect(
      view.container.querySelector(
        '.easymde-pane-preview [data-easymde-preview-html-sink]'
      )
    ).not.toBeNull();
    assertPreviewPaperFrame(
      view.container.querySelector('.easymde-pane-preview')
    );

    fireEvent.click(view.getByRole('button', { name: '预览' }));
    expect(
      view.container
        .querySelector('.easymde-editor')
        ?.classList.contains('is-immersive-preview')
    ).toBe(true);
    const previewPane = view.container.querySelector('.easymde-pane-preview');
    expect(
      previewPane?.classList.contains('easymde-immersive-preview-surface')
    ).toBe(true);
    assertPreviewPaperFrame(previewPane);
    expect(
      previewPane?.querySelector('.easymde-immersive-preview-page')
    ).toBeNull();
    const previewSink = previewPane?.querySelector<HTMLElement>(
      '[data-easymde-preview-html-sink]'
    );
    expect(
      previewSink?.classList.contains('easymde-markdown-theme-default')
    ).toBe(true);
    expect(previewSink?.classList.contains('easymde-font-overrides')).toBe(
      false
    );
    expect(
      previewPane?.querySelector('.easymde-immersive-preview-status')
    ).not.toBeNull();
    expect(
      view.queryByRole('separator', {
        name: '调整编辑区和预览区宽度'
      })
    ).toBeNull();
    expect(
      view.queryByRole('complementary', { name: '文章大纲' })
    ).not.toBeNull();
    expect(view.getAllByRole('button', { name: '收起大纲' })).toHaveLength(2);
    expect(
      view.queryByRole('separator', { name: '调整大纲宽度' })
    ).not.toBeNull();
    const previewHideOutline = view.getAllByRole('button', {
      name: '收起大纲'
    })[0];
    if (!previewHideOutline)
      throw new Error('preview-outline-close-unavailable');
    fireEvent.click(previewHideOutline);
    expect(view.queryByRole('complementary', { name: '文章大纲' })).toBeNull();
    fireEvent.click(view.getByRole('button', { name: '展开大纲' }));
    expect(
      view.queryByRole('complementary', { name: '文章大纲' })
    ).not.toBeNull();
    expect(
      view.container.querySelectorAll('[data-easymde-preview-html-sink]')
    ).toHaveLength(1);
    await waitFor(() =>
      expect(
        previewPane?.querySelector('[data-easymde-preview-html-sink] p')
          ?.textContent
      ).toBe('Rendered')
    );
    const scrollDisposeCount =
      props.scrollSyncBinding.dispose.mock.calls.length;
    fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
    expect(props.scrollSyncBinding.dispose).toHaveBeenCalledTimes(
      scrollDisposeCount
    );
    const visualEditor = await view.findByRole('textbox', {
      name: '可视化文章编辑器'
    });
    expect(
      view.container
        .querySelector('.easymde-editor')
        ?.classList.contains('is-immersive-preview')
    ).toBe(true);
    expect(visualEditor.getAttribute('contenteditable')).toBe('true');
    visualEditor.innerHTML = '<p>Changed visually</p><p>Body</p>';
    fireEvent.input(visualEditor);
    await waitFor(() =>
      expect(props.submissionField.value).toBe('Changed visually\n\nBody')
    );
    expect(view.getByText('更改已记录')).not.toBeNull();
    expect(view.getByRole('button', { name: '锁定为只读' })).not.toBeNull();
    expect(
      view.container.querySelectorAll('[data-easymde-document-owner="react"]')
    ).toHaveLength(1);
    expect(
      view.container.querySelectorAll('[data-easymde-preview-html-sink]')
    ).toHaveLength(1);
    expect(
      view.queryByRole('complementary', { name: '文章大纲' })
    ).not.toBeNull();
    expect(props.enhancementPort.dispose).not.toHaveBeenCalled();
    fireEvent.click(view.getByRole('button', { name: 'Image' }));
    expect(props.mediaPickerFrame?.open).toHaveBeenCalledTimes(1);
    expect(
      view.queryByRole('textbox', { name: '可视化文章编辑器' })
    ).not.toBeNull();
    const mediaFrame = props.mediaPickerFrame;
    const mediaOpen = mediaFrame
      ? vi.mocked(mediaFrame.open).mock.calls[0]?.[0]
      : undefined;
    mediaOpen?.onClose();
    fireEvent.click(view.getByRole('button', { name: '退出沉浸写作' }));
    await waitFor(() =>
      expect(view.queryByRole('region', { name: '沉浸写作' })).toBeNull()
    );
    expect(
      view.container.querySelector(
        '.easymde-pane-preview [data-easymde-preview-html-sink]'
      )
    ).not.toBeNull();
  });

  it('keeps the themed paper visible without exposing a rendering placeholder', async () => {
    const pendingPreview = deferred<PreviewResponse>();
    const props = fixture();
    vi.mocked(props.previewPort.render).mockImplementation(
      () => pendingPreview.promise
    );
    const view = render(<EditorRoot {...props} />);

    await waitFor(() =>
      expect(props.previewPort.render).toHaveBeenCalledTimes(1)
    );
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));

    expect(props.previewPort.render).toHaveBeenCalledTimes(1);
    expect(view.queryByText('Rendering')).toBeNull();
    expect(
      view.container.querySelector(
        '.easymde-pane-preview > .easymde-immersive-preview-canvas > [data-easymde-preview-html-sink]'
      )?.textContent
    ).toContain('Initial');
  });

  it('unlocks an empty Markdown document as an editable themed paper', async () => {
    const baseProps = fixture();
    baseProps.submissionField.value = '';
    baseProps.submissionField.defaultValue = '';
    const props = {
      ...baseProps,
      preview: {
        ...baseProps.preview,
        html: '' as SafePreviewHtml,
        signature: ''
      }
    };
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));

    const unlock = view.getByRole('button', {
      name: '解除锁定并编辑'
    });
    await waitFor(() => expect(unlock.hasAttribute('disabled')).toBe(false));
    fireEvent.click(unlock);

    const visualEditor = await view.findByRole('textbox', {
      name: '可视化文章编辑器'
    });
    expect(visualEditor.innerHTML).toBe('<p><br></p>');
    expect(
      visualEditor.classList.contains('easymde-markdown-theme-default')
    ).toBe(true);

    visualEditor.innerHTML = '<p>First visual paragraph</p>';
    fireEvent.input(visualEditor);
    await waitFor(() =>
      expect(props.submissionField.value).toBe('First visual paragraph')
    );

    fireEvent.click(view.getByRole('button', { name: '锁定为只读' }));
    await waitFor(() =>
      expect(
        view
          .getByRole('button', { name: '解除锁定并编辑' })
          .hasAttribute('disabled')
      ).toBe(false)
    );
  });

  it('prepares the current code theme before unlocking a fresh visual document', async () => {
    const baseProps = fixture();
    baseProps.submissionField.value = '';
    baseProps.submissionField.defaultValue = '';
    const props = {
      ...baseProps,
      preview: {
        ...baseProps.preview,
        html: '' as SafePreviewHtml,
        signature: ''
      }
    };
    const preparation =
      deferred<
        Readonly<{
          cancel: () => void;
          commit: () => void;
        }>
      >();
    const prepared = { cancel: vi.fn(), commit: vi.fn() };
    vi.mocked(props.enhancementPort.prepareCodeTheme).mockReturnValue(
      preparation.promise
    );
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    const unlock = view.getByRole('button', {
      name: '解除锁定并编辑'
    });
    await waitFor(() => expect(unlock.hasAttribute('disabled')).toBe(false));

    unlock.focus();
    expect(document.activeElement).toBe(unlock);
    fireEvent.click(unlock);

    expect(unlock.getAttribute('aria-label')).toBe('解除锁定并编辑');
    expect(unlock.getAttribute('aria-busy')).toBe('true');
    expect(unlock.getAttribute('aria-disabled')).toBe('true');
    expect(unlock.hasAttribute('disabled')).toBe(false);
    expect(document.activeElement).toBe(unlock);
    expect(unlock.classList.contains('is-unlocking')).toBe(true);
    expect(
      unlock.querySelector('.easymde-immersive-preview-unlock-spinner')
    ).not.toBeNull();
    await waitFor(() =>
      expect(props.enhancementPort.prepareCodeTheme).toHaveBeenCalledWith(
        expect.objectContaining({
          codeTheme: 'atom-one-dark',
          signal: expect.any(AbortSignal)
        })
      )
    );
    expect(
      view.queryByRole('textbox', {
        name: '可视化文章编辑器'
      })
    ).toBeNull();
    expect(props.submissionField.value).toBe('');

    await act(async () => preparation.resolve(prepared));

    const visualEditor = await view.findByRole('textbox', {
      name: '可视化文章编辑器'
    });
    expect(visualEditor.innerHTML).toBe('<p><br></p>');
    const lock = view.getByRole('button', { name: '锁定为只读' });
    expect(lock.hasAttribute('aria-busy')).toBe(false);
    expect(lock.hasAttribute('disabled')).toBe(false);
    expect(prepared.commit).toHaveBeenCalledOnce();
    expect(props.submissionField.value).toBe('');
  });

  it('waits for the visual surface before handing compact Outline focus to Preview', async () => {
    const baseProps = fixture();
    const markdown = '# Heading';
    baseProps.submissionField.value = markdown;
    baseProps.submissionField.defaultValue = markdown;
    const previewHtml = '<h1>Heading</h1>' as SafePreviewHtml;
    const props = {
      ...baseProps,
      preview: {
        ...baseProps.preview,
        html: previewHtml,
        signature: 'compact-focus'
      }
    };
    const preparation =
      deferred<
        Readonly<{
          cancel: () => void;
          commit: () => void;
        }>
      >();
    const prepared = { cancel: vi.fn(), commit: vi.fn() };
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      Promise.resolve(createPreviewResponse(request, previewHtml, {}))
    );
    vi.mocked(props.enhancementPort.prepareCodeTheme).mockReturnValue(
      preparation.promise
    );
    vi.spyOn(props.immersiveEnvironment, 'viewportWidth').mockReturnValue(390);
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    const outlineControl = view.container.querySelector<HTMLButtonElement>(
      '.easymde-immersive-outline button'
    );
    if (!outlineControl)
      throw new Error('compact-test-outline-control-unavailable');
    outlineControl.focus();
    expect(document.activeElement).toBe(outlineControl);

    const unlock = view.getByRole('button', { name: '解除锁定并编辑' });
    await waitFor(() => expect(unlock.hasAttribute('disabled')).toBe(false));
    const nativeFocus = HTMLElement.prototype.focus;
    let visualSurfaceFocusAttempts = 0;
    const focusSpy = vi
      .spyOn(HTMLElement.prototype, 'focus')
      .mockImplementation(function (this: HTMLElement, options?: FocusOptions) {
        if (this.classList.contains('easymde-immersive-visual-editor')) {
          visualSurfaceFocusAttempts += 1;
        }
        nativeFocus.call(this, options);
      });

    try {
      fireEvent.click(unlock);
      await waitFor(() =>
        expect(props.enhancementPort.prepareCodeTheme).toHaveBeenCalledOnce()
      );
      expect(unlock.getAttribute('aria-busy')).toBe('true');
      expect(
        view.container.querySelector('.easymde-immersive-outline')
      ).not.toBeNull();
      expect(document.activeElement).toBe(outlineControl);

      await act(async () => preparation.resolve(prepared));

      expect(prepared.commit).toHaveBeenCalledOnce();
      const visualSurface = view.container.querySelector<HTMLElement>(
        '.easymde-immersive-visual-editor'
      );
      if (!visualSurface)
        throw new Error('compact-test-visual-surface-unavailable');
      expect(visualSurface.getAttribute('contenteditable')).toBe('true');
      expect(visualSurface.getAttribute('role')).toBe('textbox');
      expect(visualSurface.getAttribute('aria-label')).toBe('可视化文章编辑器');
      await waitFor(() =>
        expect(
          view.container.querySelector('.easymde-immersive-outline')
        ).toBeNull()
      );
      expect(visualSurfaceFocusAttempts).toBe(1);
      expect(document.activeElement).toBe(visualSurface);
      expect(props.onFailure).not.toHaveBeenCalledWith(
        'visual-editor-focus-surface-unavailable'
      );
      expect(props.onFailure).not.toHaveBeenCalledWith(
        'visual-editor-focus-surface-failed'
      );
    } finally {
      focusSpy.mockRestore();
    }
  });

  it('prepares code resources for a non-empty visual document and syncs each new code frame once', async () => {
    const props = fixture();
    const preparation =
      deferred<
        Readonly<{
          cancel: () => void;
          commit: () => void;
        }>
      >();
    const prepared = { cancel: vi.fn(), commit: vi.fn() };
    vi.mocked(props.enhancementPort.prepareCodeTheme).mockReturnValue(
      preparation.promise
    );
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    const unlock = view.getByRole('button', {
      name: '解除锁定并编辑'
    });
    await waitFor(() => expect(unlock.hasAttribute('disabled')).toBe(false));
    fireEvent.click(unlock);

    await waitFor(() =>
      expect(props.enhancementPort.prepareCodeTheme).toHaveBeenCalledWith(
        expect.objectContaining({
          codeTheme: 'atom-one-dark',
          signal: expect.any(AbortSignal)
        })
      )
    );
    expect(
      view.queryByRole('textbox', {
        name: '可视化文章编辑器'
      })
    ).toBeNull();

    await act(async () => preparation.resolve(prepared));

    const visualEditor = await view.findByRole('textbox', {
      name: '可视化文章编辑器'
    });
    expect(prepared.commit).toHaveBeenCalledOnce();
    const syncBaseline = vi.mocked(
      props.enhancementPort.syncCodeFrameBackgrounds
    ).mock.calls.length;

    const paragraphText = visualEditor.querySelector('p')?.firstChild;
    if (!(paragraphText instanceof Text)) {
      throw new Error('visual-code-frame-test-selection-missing');
    }
    const range = document.createRange();
    range.selectNodeContents(paragraphText);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    visualEditor.dispatchEvent(
      new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        data: '~~~',
        inputType: 'insertText'
      })
    );
    paragraphText.data = '~~~';
    range.setStart(paragraphText, paragraphText.length);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
    visualEditor.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        data: '~~~',
        inputType: 'insertText'
      })
    );
    await waitFor(() => expect(props.submissionField.value).toBe('~~~'));
    range.setStart(paragraphText, paragraphText.length);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
    visualEditor.dispatchEvent(
      new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'Enter'
      })
    );
    expect(visualEditor.querySelector('pre > code.hljs')).not.toBeNull();
    await waitFor(() => expect(props.submissionField.value).toBe('```\n\n```'));
    await waitFor(() =>
      expect(
        props.enhancementPort.syncCodeFrameBackgrounds
      ).toHaveBeenCalledTimes(syncBaseline + 1)
    );
    expect(
      props.enhancementPort.syncCodeFrameBackgrounds
    ).toHaveBeenLastCalledWith(visualEditor);

    fireEvent.input(visualEditor);
    expect(
      props.enhancementPort.syncCodeFrameBackgrounds
    ).toHaveBeenCalledTimes(syncBaseline + 1);
  });

  it('ignores a repeated fresh unlock and abandons it when the code theme changes', async () => {
    const baseProps = fixture();
    baseProps.submissionField.value = '';
    baseProps.submissionField.defaultValue = '';
    const props = {
      ...baseProps,
      preview: {
        ...baseProps.preview,
        html: '' as SafePreviewHtml,
        signature: ''
      }
    };
    const pendingPreparation =
      deferred<
        Readonly<{
          cancel: () => void;
          commit: () => void;
        }>
      >();
    const prepared = { cancel: vi.fn(), commit: vi.fn() };
    const githubPrepared = { cancel: vi.fn(), commit: vi.fn() };
    let unlockSignal: AbortSignal | null = null;
    vi.mocked(props.enhancementPort.prepareCodeTheme).mockImplementation(
      ({ codeTheme, signal }) => {
        if ('atom-one-dark' === codeTheme) {
          unlockSignal = signal;
          return pendingPreparation.promise;
        }
        return Promise.resolve(githubPrepared);
      }
    );
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    const unlock = view.getByRole('button', {
      name: '解除锁定并编辑'
    });
    await waitFor(() => expect(unlock.hasAttribute('disabled')).toBe(false));
    fireEvent.click(unlock);
    fireEvent.click(unlock);

    await waitFor(() =>
      expect(props.enhancementPort.prepareCodeTheme).toHaveBeenCalledTimes(1)
    );
    expect(unlock.getAttribute('aria-busy')).toBe('true');
    expect(unlock.getAttribute('aria-disabled')).toBe('true');
    expect(unlock.hasAttribute('disabled')).toBe(false);
    expect(
      view.queryByRole('textbox', {
        name: '可视化文章编辑器'
      })
    ).toBeNull();

    fireEvent.click(view.getByRole('button', { name: '主题' }));
    fireEvent.click(view.getByRole('button', { name: 'Code theme' }));
    fireEvent.click(view.getByRole('option', { name: 'GitHub' }));
    await waitFor(() => expect(unlockSignal?.aborted).toBe(true));
    expect(unlock.hasAttribute('aria-busy')).toBe(false);
    expect(unlock.hasAttribute('disabled')).toBe(false);
    expect(unlock.classList.contains('is-unlocking')).toBe(false);

    await act(async () => pendingPreparation.resolve(prepared));
    expect(prepared.cancel).toHaveBeenCalledOnce();
    expect(prepared.commit).not.toHaveBeenCalled();
    expect(
      view.queryByRole('textbox', {
        name: '可视化文章编辑器'
      })
    ).toBeNull();
    await waitFor(() =>
      expect(props.appearancePort.applyState).toHaveBeenCalledWith(
        {
          codeTheme: 'github',
          customCssId: '',
          markdownTheme: 'default'
        },
        true
      )
    );
  });

  it('reports a fresh unlock preparation failure and allows a later retry', async () => {
    const baseProps = fixture();
    baseProps.submissionField.value = '';
    baseProps.submissionField.defaultValue = '';
    const props = {
      ...baseProps,
      preview: {
        ...baseProps.preview,
        html: '' as SafePreviewHtml,
        signature: ''
      }
    };
    const prepared = { cancel: vi.fn(), commit: vi.fn() };
    vi.mocked(props.enhancementPort.prepareCodeTheme)
      .mockRejectedValueOnce(
        new Error('preview-enhancement-resource-load-failed')
      )
      .mockResolvedValueOnce(prepared);
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    const unlock = view.getByRole('button', {
      name: '解除锁定并编辑'
    });
    await waitFor(() => expect(unlock.hasAttribute('disabled')).toBe(false));
    fireEvent.click(unlock);

    await waitFor(() =>
      expect(props.onFailure).toHaveBeenCalledWith(
        'preview-enhancement-resource-load-failed'
      )
    );
    expect(unlock.hasAttribute('aria-busy')).toBe(false);
    expect(unlock.hasAttribute('disabled')).toBe(false);
    expect(unlock.classList.contains('is-unlocking')).toBe(false);
    expect(
      view.queryByRole('textbox', {
        name: '可视化文章编辑器'
      })
    ).toBeNull();
    fireEvent.click(unlock);
    const visualEditor = await view.findByRole('textbox', {
      name: '可视化文章编辑器'
    });
    expect(visualEditor.getAttribute('contenteditable')).toBe('true');
    expect(prepared.commit).toHaveBeenCalledOnce();
  });

  it('aborts a pending fresh unlock when immersive mode changes', async () => {
    const baseProps = fixture();
    baseProps.submissionField.value = '';
    baseProps.submissionField.defaultValue = '';
    const props = {
      ...baseProps,
      preview: {
        ...baseProps.preview,
        html: '' as SafePreviewHtml,
        signature: ''
      }
    };
    const pendingPreparation =
      deferred<
        Readonly<{
          cancel: () => void;
          commit: () => void;
        }>
      >();
    const prepared = { cancel: vi.fn(), commit: vi.fn() };
    let unlockSignal: AbortSignal | null = null;
    vi.mocked(props.enhancementPort.prepareCodeTheme).mockImplementation(
      ({ signal }) => {
        unlockSignal = signal;
        return pendingPreparation.promise;
      }
    );
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    const unlock = view.getByRole('button', {
      name: '解除锁定并编辑'
    });
    await waitFor(() => expect(unlock.hasAttribute('disabled')).toBe(false));
    fireEvent.click(unlock);
    await waitFor(() => expect(unlockSignal).not.toBeNull());

    fireEvent.click(view.getByRole('button', { name: '分屏模式' }));
    await waitFor(() => expect(unlockSignal?.aborted).toBe(true));
    await act(async () => pendingPreparation.resolve(prepared));

    expect(prepared.cancel).toHaveBeenCalledOnce();
    expect(prepared.commit).not.toHaveBeenCalled();
    expect(
      view.container
        .querySelector('.easymde-editor')
        ?.classList.contains('is-immersive-split')
    ).toBe(true);
    expect(
      view.queryByRole('textbox', {
        name: '可视化文章编辑器'
      })
    ).toBeNull();

    fireEvent.click(view.getByRole('button', { name: '预览' }));
    const relockedPreview = view.getByRole('button', {
      name: '解除锁定并编辑'
    });
    expect(relockedPreview.hasAttribute('aria-busy')).toBe(false);
    expect(relockedPreview.hasAttribute('disabled')).toBe(false);
  });

  it('does not enable a fresh unlock after its Preview snapshot becomes stale', async () => {
    const baseProps = fixture();
    baseProps.submissionField.value = '';
    baseProps.submissionField.defaultValue = '';
    const props = {
      ...baseProps,
      preview: {
        ...baseProps.preview,
        html: '' as SafePreviewHtml,
        signature: ''
      }
    };
    const pendingPreparation =
      deferred<
        Readonly<{
          cancel: () => void;
          commit: () => void;
        }>
      >();
    const prepared = { cancel: vi.fn(), commit: vi.fn() };
    vi.mocked(props.enhancementPort.prepareCodeTheme).mockReturnValue(
      pendingPreparation.promise
    );
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    const unlock = view.getByRole('button', {
      name: '解除锁定并编辑'
    });
    await waitFor(() => expect(unlock.hasAttribute('disabled')).toBe(false));
    fireEvent.click(unlock);
    await waitFor(() =>
      expect(props.enhancementPort.prepareCodeTheme).toHaveBeenCalledOnce()
    );

    const source = view.getByRole('textbox', { name: 'Markdown source' });
    const sourceView = EditorView.findFromDOM(source);
    if (!sourceView) throw new Error('markdown-source-view-unavailable');
    act(() => {
      sourceView.dispatch({
        changes: { from: 0, insert: 'Snapshot changed' }
      });
    });
    await waitFor(() =>
      expect(props.submissionField.value).toBe('Snapshot changed')
    );
    expect(unlock.hasAttribute('aria-busy')).toBe(false);
    expect(unlock.classList.contains('is-unlocking')).toBe(false);
    expect(unlock.hasAttribute('disabled')).toBe(true);
    expect(
      vi.mocked(props.enhancementPort.prepareCodeTheme).mock.calls[0]?.[0]
        .signal.aborted
    ).toBe(true);

    await act(async () => pendingPreparation.resolve(prepared));
    expect(prepared.cancel).toHaveBeenCalledOnce();
    expect(prepared.commit).not.toHaveBeenCalled();
    expect(
      view.queryByRole('textbox', {
        name: '可视化文章编辑器'
      })
    ).toBeNull();
  });

  it('cancels a pending fresh unlock on unmount and ignores its late result', async () => {
    const baseProps = fixture();
    baseProps.submissionField.value = '';
    baseProps.submissionField.defaultValue = '';
    const props = {
      ...baseProps,
      preview: {
        ...baseProps.preview,
        html: '' as SafePreviewHtml,
        signature: ''
      }
    };
    const pendingPreparation =
      deferred<
        Readonly<{
          cancel: () => void;
          commit: () => void;
        }>
      >();
    const prepared = { cancel: vi.fn(), commit: vi.fn() };
    let unlockSignal: AbortSignal | null = null;
    vi.mocked(props.enhancementPort.prepareCodeTheme).mockImplementation(
      ({ signal }) => {
        unlockSignal = signal;
        return pendingPreparation.promise;
      }
    );
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    const unlock = view.getByRole('button', {
      name: '解除锁定并编辑'
    });
    await waitFor(() => expect(unlock.hasAttribute('disabled')).toBe(false));
    fireEvent.click(unlock);
    await waitFor(() => expect(unlockSignal).not.toBeNull());

    view.unmount();
    expect((unlockSignal as AbortSignal | null)?.aborted).toBe(true);
    await act(async () => pendingPreparation.resolve(prepared));
    expect(prepared.cancel).toHaveBeenCalledOnce();
    expect(prepared.commit).not.toHaveBeenCalled();
  });

  it('finishes a large Preview window before enabling visual editing and restores the full Preview on lock', async () => {
    const props = fixture();
    const markdown = Array.from(
      { length: 200 },
      (_, index) => `Paragraph ${index}`
    ).join('\n');
    const html = Array.from(
      { length: 200 },
      (_, index) => `<p>Paragraph ${index}</p>`
    ).join('') as SafePreviewHtml;
    props.submissionField.value = markdown;
    props.submissionField.defaultValue = markdown;
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      Promise.resolve(createPreviewResponse(request, html, {}))
    );
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    const unlock = view.getByRole('button', {
      name: '解除锁定并编辑'
    });
    await waitFor(() => expect(unlock.hasAttribute('disabled')).toBe(false));
    fireEvent.click(unlock);

    expect(
      view.queryByRole('textbox', {
        name: '可视化文章编辑器'
      })
    ).toBeNull();
    const visualEditor = await view.findByRole('textbox', {
      name: '可视化文章编辑器'
    });
    expect(
      visualEditor.querySelectorAll('[data-easymde-visual-block-id]').length
    ).toBeLessThanOrEqual(160);
    expect(
      visualEditor.querySelector('[data-easymde-preview-window-spacer]')
    ).not.toBeNull();

    fireEvent.click(view.getByRole('button', { name: '锁定为只读' }));
    await waitFor(() =>
      expect(
        view.queryByRole('textbox', {
          name: '可视化文章编辑器'
        })
      ).toBeNull()
    );
    const sink = view.container.querySelector(
      '[data-easymde-preview-html-sink="1"]'
    );
    await waitFor(() =>
      expect(
        sink?.querySelectorAll('[data-easymde-visual-block-id]')
      ).toHaveLength(200)
    );
    expect(
      sink?.querySelector('[data-easymde-preview-window-spacer]')
    ).toBeNull();
  });

  it('does not unlock a queued windowed visual Preview after a newer snapshot supersedes it', async () => {
    const props = fixture();
    const markdown = Array.from(
      { length: 200 },
      (_, index) => `Paragraph ${index}`
    ).join('\n');
    const initialHtml = Array.from(
      { length: 200 },
      (_, index) => `<p>Paragraph ${index}</p>`
    ).join('') as SafePreviewHtml;
    const supersedingHtml = Array.from(
      { length: 200 },
      (_, index) =>
        `<p>${0 === index ? 'Superseded' : `Paragraph ${index}`}</p>`
    ).join('') as SafePreviewHtml;
    props.submissionField.value = markdown;
    props.submissionField.defaultValue = markdown;
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      Promise.resolve(
        createPreviewResponse(
          request,
          request.markdown === markdown ? initialHtml : supersedingHtml,
          {}
        )
      )
    );
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    const unlock = view.getByRole('button', {
      name: '解除锁定并编辑'
    });
    await waitFor(() => expect(unlock.hasAttribute('disabled')).toBe(false));

    const frameQueue = createQueuedAnimationFrames();
    try {
      fireEvent.click(unlock);
      await waitFor(() => expect(frameQueue.callbacks.size).toBeGreaterThan(0));
      expect(unlock.getAttribute('aria-busy')).toBe('true');
      expect(unlock.getAttribute('aria-disabled')).toBe('true');
      expect(unlock.hasAttribute('disabled')).toBe(false);
      const supersededReadyCallbacks = [...frameQueue.callbacks.values()];
      expect(supersededReadyCallbacks.length).toBeGreaterThan(0);

      const source = view.getByRole('textbox', { name: 'Markdown source' });
      const sourceView = EditorView.findFromDOM(source);
      if (!sourceView) throw new Error('markdown-source-view-unavailable');
      act(() => {
        sourceView.dispatch({
          changes: {
            from: sourceView.state.doc.length,
            insert: '\nSuperseded'
          }
        });
      });
      await waitFor(() =>
        expect(props.submissionField.value).toContain('\nSuperseded')
      );
      expect(unlock.hasAttribute('aria-busy')).toBe(false);
      expect(unlock.classList.contains('is-unlocking')).toBe(false);
      await drainAnimationFrames(frameQueue);
      let supersededCallbacksDelivered = 0;
      act(() => {
        for (const callback of supersededReadyCallbacks) {
          callback(0);
          supersededCallbacksDelivered += 1;
        }
      });
      expect(supersededCallbacksDelivered).toBeGreaterThan(0);
      expect(unlock.hasAttribute('aria-busy')).toBe(false);
      expect(
        view.queryByRole('textbox', {
          name: '可视化文章编辑器'
        })
      ).toBeNull();
      expect(props.submissionField.value).toBe(`${markdown}\nSuperseded`);
    } finally {
      view.unmount();
      frameQueue.restore();
    }
  });

  it('does not unlock a canceled windowed visual Preview after a late ready callback', async () => {
    const props = fixture();
    const markdown = Array.from(
      { length: 200 },
      (_, index) => `Paragraph ${index}`
    ).join('\n');
    const html = Array.from(
      { length: 200 },
      (_, index) => `<p>Paragraph ${index}</p>`
    ).join('') as SafePreviewHtml;
    props.submissionField.value = markdown;
    props.submissionField.defaultValue = markdown;
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      Promise.resolve(createPreviewResponse(request, html, {}))
    );
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    const unlock = view.getByRole('button', {
      name: '解除锁定并编辑'
    });
    await waitFor(() => expect(unlock.hasAttribute('disabled')).toBe(false));

    const frameQueue = createQueuedAnimationFrames();
    try {
      fireEvent.click(unlock);
      await waitFor(() => expect(frameQueue.callbacks.size).toBeGreaterThan(0));
      expect(unlock.getAttribute('aria-busy')).toBe('true');
      expect(unlock.getAttribute('aria-disabled')).toBe('true');
      expect(unlock.hasAttribute('disabled')).toBe(false);
      const canceledReadyCallbacks = [...frameQueue.callbacks.values()];
      expect(canceledReadyCallbacks.length).toBeGreaterThan(0);
      fireEvent.click(view.getByRole('button', { name: '分屏模式' }));
      await drainAnimationFrames(frameQueue);
      expect(
        view.queryByRole('textbox', {
          name: '可视化文章编辑器'
        })
      ).toBeNull();
      fireEvent.click(view.getByRole('button', { name: '预览' }));
      const relockedPreview = view.getByRole('button', {
        name: '解除锁定并编辑'
      });
      expect(relockedPreview.hasAttribute('aria-busy')).toBe(false);
      expect(relockedPreview.hasAttribute('disabled')).toBe(false);
      let canceledCallbacksDelivered = 0;
      act(() => {
        for (const callback of canceledReadyCallbacks) {
          callback(0);
          canceledCallbacksDelivered += 1;
        }
      });
      expect(canceledCallbacksDelivered).toBeGreaterThan(0);
      expect(
        document.body.querySelector('[aria-label="可视化文章编辑器"]')
      ).toBeNull();
      expect(relockedPreview.hasAttribute('aria-busy')).toBe(false);
      expect(props.submissionField.value).toBe(markdown);
    } finally {
      view.unmount();
      frameQueue.restore();
    }
  });

  it('synchronizes visual typing within a bounded input window without duplicating the native submission write', async () => {
    const props = fixture();
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      Promise.resolve(
        createPreviewResponse(request, '<p>selected</p>' as SafePreviewHtml, {})
      )
    );
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
    fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
    const visualEditor = await view.findByRole('textbox', {
      name: '可视化文章编辑器'
    });
    const canonicalInput = vi.fn();
    props.submissionField.addEventListener('input', canonicalInput);

    visualEditor.innerHTML = '<p>First visual value</p>';
    fireEvent.input(visualEditor);
    await waitFor(() => {
      expect(props.submissionField.value).toBe('First visual value');
      expect(canonicalInput).toHaveBeenCalledOnce();
    });

    visualEditor.innerHTML = '<p>Final visual value</p>';
    fireEvent.input(visualEditor);
    await waitFor(() => {
      expect(props.submissionField.value).toBe('Final visual value');
      expect(canonicalInput).toHaveBeenCalledTimes(2);
    });

    visualEditor.innerHTML = '<p>Submitted visual value</p>';
    fireEvent.input(visualEditor);
    await waitFor(() => {
      expect(props.submissionField.value).toBe('Submitted visual value');
      expect(canonicalInput).toHaveBeenCalledTimes(3);
    });

    const submitEvent = new SubmitEvent('submit', {
      bubbles: true,
      cancelable: true
    });
    act(() => {
      expect(props.nativeForm.dispatchEvent(submitEvent)).toBe(true);
    });
    expect(props.submissionField.value).toBe('Submitted visual value');
    expect(canonicalInput).toHaveBeenCalledTimes(3);
    props.submissionField.removeEventListener('input', canonicalInput);
  });

  it('synchronizes visual input to the canonical field before browser navigation can inspect dirty state', async () => {
    const props = fixture();
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      Promise.resolve(
        createPreviewResponse(request, '<p>selected</p>' as SafePreviewHtml, {})
      )
    );
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
    fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
    const visualEditor = await view.findByRole('textbox', {
      name: '可视化文章编辑器'
    });
    const canonicalInput = vi.fn();
    props.submissionField.addEventListener('input', canonicalInput);

    visualEditor.innerHTML = '<p>Navigation-safe visual value</p>';
    fireEvent.input(visualEditor);

    await waitFor(() => {
      expect(props.submissionField.value).toBe('Navigation-safe visual value');
      expect(canonicalInput).toHaveBeenCalledOnce();
    });
    props.submissionField.removeEventListener('input', canonicalInput);
  });

  it('flushes pending visual Markdown before WordPress autosave without leaving visual editing', async () => {
    const props = fixture();
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      Promise.resolve(
        createPreviewResponse(request, '<p>selected</p>' as SafePreviewHtml, {})
      )
    );
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
    fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
    const visualEditor = await view.findByRole('textbox', {
      name: '可视化文章编辑器'
    });

    vi.useFakeTimers();
    try {
      visualEditor.innerHTML = '<p>Heartbeat visual value</p>';
      fireEvent.input(visualEditor);
      expect(props.submissionField.value).toBe('selected');

      expect(props.sessionAutosave()).toBe('continue');
      expect(props.submissionField.value).toBe('Heartbeat visual value');
      expect(view.getByRole('textbox', { name: '可视化文章编辑器' })).toBe(
        visualEditor
      );
      expect(view.getByRole('button', { name: '锁定为只读' })).not.toBeNull();

      act(() => vi.advanceTimersByTime(640));
      expect(props.submissionField.value).toBe('Heartbeat visual value');
    } finally {
      vi.useRealTimers();
    }
  });

  it('synchronizes continuous visual typing immediately and stores the latest local draft', async () => {
    const baseProps = fixture();
    const props = {
      ...baseProps,
      settings: {
        general: {
          ...baseProps.settings.general,
          autoSaveInterval: '5'
        },
        markdown: baseProps.settings.markdown
      }
    };
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      Promise.resolve(
        createPreviewResponse(request, '<p>selected</p>' as SafePreviewHtml, {})
      )
    );
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
    fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
    const visualEditor = await view.findByRole('textbox', {
      name: '可视化文章编辑器'
    });
    const canonicalInput = vi.fn();
    props.submissionField.addEventListener('input', canonicalInput);

    vi.useFakeTimers();
    try {
      for (let index = 0; index <= 6; index += 1) {
        visualEditor.innerHTML = `<p>Continuous value ${index}</p>`;
        fireEvent.input(visualEditor);
        if (index < 6) {
          act(() => vi.advanceTimersByTime(100));
        }
      }

      act(() => vi.advanceTimersByTime(80));

      expect(props.submissionField.value).toBe('Continuous value 6');
      expect(canonicalInput).toHaveBeenCalledTimes(7);

      act(() => vi.advanceTimersByTime(4999));
      expect(props.localDraftStorage.write).not.toHaveBeenCalled();
      act(() => vi.advanceTimersByTime(1));
      expect(props.localDraftStorage.write).toHaveBeenCalledOnce();
      expect(props.localDraftStorage.write).toHaveBeenCalledWith(
        'Continuous value 6'
      );
      expect(canonicalInput).toHaveBeenCalledTimes(7);
    } finally {
      vi.useRealTimers();
      props.submissionField.removeEventListener('input', canonicalInput);
    }
  });

  it('turns the first empty-paper heading shortcut into themed visual markup', async () => {
    const baseProps = fixture();
    baseProps.submissionField.value = '';
    baseProps.submissionField.defaultValue = '';
    const props = {
      ...baseProps,
      preview: {
        ...baseProps.preview,
        html: '' as SafePreviewHtml,
        signature: ''
      }
    };
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    const unlock = view.getByRole('button', {
      name: '解除锁定并编辑'
    });
    await waitFor(() => expect(unlock.hasAttribute('disabled')).toBe(false));
    fireEvent.click(unlock);

    const visualEditor = await view.findByRole('textbox', {
      name: '可视化文章编辑器'
    });
    const paragraph = visualEditor.querySelector('p');
    if (!paragraph) throw new Error('missing empty visual paragraph');
    paragraph.textContent = '#';
    const marker = paragraph.firstChild;
    if (!(marker instanceof Text)) {
      throw new Error('missing empty visual heading marker');
    }
    const markerRange = document.createRange();
    markerRange.setStart(marker, marker.length);
    markerRange.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(markerRange);
    fireEvent.input(visualEditor);

    expect(fireEvent.keyDown(visualEditor, { key: ' ' })).toBe(false);
    const heading = visualEditor.querySelector('h1');
    expect(heading).not.toBeNull();
    expect(visualEditor.querySelector('p')).toBeNull();
    expect(visualEditor.textContent).not.toContain('#');
    await waitFor(() => expect(props.submissionField.value).toBe('#'));

    if (!heading) throw new Error('missing transformed visual heading');
    heading.textContent = 'First themed heading';
    const headingText = heading.firstChild;
    if (!(headingText instanceof Text)) {
      throw new Error('missing transformed visual heading text');
    }
    const headingRange = document.createRange();
    headingRange.setStart(headingText, headingText.length);
    headingRange.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(headingRange);
    fireEvent.input(visualEditor);

    await waitFor(() =>
      expect(props.submissionField.value).toBe('# First themed heading')
    );
    expect(heading.textContent).toBe('First themed heading');
  });

  it('commits IME composition once and removes its listeners on teardown', async () => {
    const props = fixture();
    props.submissionField.value = 'Before';
    props.submissionField.defaultValue = 'Before';
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      Promise.resolve(
        createPreviewResponse(request, '<p>Before</p>' as SafePreviewHtml, {})
      )
    );
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
    fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
    const visualEditor = await view.findByRole('textbox', {
      name: '可视化文章编辑器'
    });
    const paragraph = visualEditor.querySelector('p');
    if (!paragraph) throw new Error('missing IME visual paragraph');
    const canonicalInput = vi.fn();
    props.submissionField.addEventListener('input', canonicalInput);

    fireEvent.compositionStart(visualEditor);
    paragraph.textContent = 'Before 中文';
    const composedText = paragraph.firstChild;
    if (!(composedText instanceof Text)) {
      throw new Error('missing IME composed text');
    }
    const composedRange = document.createRange();
    composedRange.setStart(composedText, composedText.length);
    composedRange.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(composedRange);
    fireEvent.input(visualEditor, {
      data: '中文',
      inputType: 'insertCompositionText',
      isComposing: true
    });

    expect(props.submissionField.value).toBe('Before');
    expect(canonicalInput).not.toHaveBeenCalled();

    fireEvent.compositionEnd(visualEditor, { data: '中文' });
    fireEvent.input(visualEditor, {
      data: '中文',
      inputType: 'insertFromComposition',
      isComposing: false
    });

    await waitFor(() =>
      expect(props.submissionField.value).toBe('Before 中文')
    );
    expect(canonicalInput).toHaveBeenCalledTimes(1);

    fireEvent.compositionStart(visualEditor);
    paragraph.textContent = 'Before 中文 stale';
    view.unmount();
    fireEvent.compositionEnd(visualEditor, { data: 'stale' });
    fireEvent.input(visualEditor, {
      data: 'stale',
      inputType: 'insertFromComposition',
      isComposing: false
    });
    await act(async () => Promise.resolve());

    expect(props.submissionField.value).toBe('Before 中文');
    expect(canonicalInput).toHaveBeenCalledTimes(1);
    props.submissionField.removeEventListener('input', canonicalInput);
  });

  it('renders the first Markdown paste into an empty themed paper', async () => {
    const baseProps = fixture();
    baseProps.submissionField.value = '';
    baseProps.submissionField.defaultValue = '';
    const pastedMarkdown = '# First heading\n\n- First item\n- Second item';
    const props = {
      ...baseProps,
      preview: {
        ...baseProps.preview,
        html: '' as SafePreviewHtml,
        signature: ''
      }
    };
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      Promise.resolve(
        createPreviewResponse(
          request,
          request.markdown === pastedMarkdown
            ? ('<h1>First heading</h1><ul><li>First item</li><li>Second item</li></ul>' as SafePreviewHtml)
            : ('' as SafePreviewHtml),
          {}
        )
      )
    );
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
    const visualEditor = await view.findByRole('textbox', {
      name: '可视化文章编辑器'
    });
    const range = document.createRange();
    range.setStart(visualEditor, 0);
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    fireEvent.paste(visualEditor, {
      clipboardData: {
        getData: (type: string) =>
          'text/plain' === type ? pastedMarkdown : '<h1>unsafe</h1>'
      }
    });

    expect(props.submissionField.value).toBe(pastedMarkdown);
    expect(visualEditor.textContent).not.toContain('# First heading');
    await waitFor(() => {
      expect(visualEditor.querySelector('h1')?.textContent).toBe(
        'First heading'
      );
      expect(visualEditor.querySelectorAll('li')).toHaveLength(2);
      expect(visualEditor.getAttribute('contenteditable')).toBe('true');
    });
  });

  it('keeps an empty themed paper source-free while the first Markdown paste renders', async () => {
    const pastedPreview = deferred<PreviewResponse>();
    const baseProps = fixture();
    baseProps.submissionField.value = '';
    baseProps.submissionField.defaultValue = '';
    const pastedMarkdown = '# Themed heading\n\n- First item\n- Second item';
    const props = {
      ...baseProps,
      appearance: {
        ...baseProps.appearance,
        state: {
          ...baseProps.appearance.state,
          markdownTheme: 'newsprint'
        }
      },
      preview: {
        ...baseProps.preview,
        html: '' as SafePreviewHtml,
        signature: ''
      }
    };
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      request.markdown === pastedMarkdown
        ? pastedPreview.promise
        : Promise.resolve(
            createPreviewResponse(request, '' as SafePreviewHtml, {})
          )
    );
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    const unlock = view.getByRole('button', {
      name: '解除锁定并编辑'
    });
    await waitFor(() => expect(unlock.hasAttribute('disabled')).toBe(false));
    fireEvent.click(unlock);
    const visualEditor = await view.findByRole('textbox', {
      name: '可视化文章编辑器'
    });
    const range = document.createRange();
    range.setStart(visualEditor, 0);
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    fireEvent.paste(visualEditor, {
      clipboardData: {
        getData: (type: string) =>
          'text/plain' === type ? pastedMarkdown : '<h1>unsafe</h1>'
      }
    });

    expect(props.submissionField.value).toBe(pastedMarkdown);
    expect(visualEditor.innerHTML).toBe('<p><br></p>');
    expect(visualEditor.textContent).not.toContain('# Themed heading');
    expect(visualEditor.querySelector('h1')).toBeNull();
    expect(visualEditor.querySelector('[onclick]')).toBeNull();
    expect(visualEditor.getAttribute('aria-busy')).toBe('true');
    expect(visualEditor.getAttribute('contenteditable')).toBe('true');
    expect(
      visualEditor.classList.contains('easymde-markdown-theme-newsprint')
    ).toBe(true);
    expect(view.queryByText('Rendering')).toBeNull();
    await waitFor(() =>
      expect(props.previewPort.render).toHaveBeenLastCalledWith(
        expect.objectContaining({
          markdown: pastedMarkdown,
          markdownTheme: 'newsprint'
        }),
        expect.any(AbortSignal)
      )
    );

    await act(async () => {
      const [request] = vi.mocked(props.previewPort.render).mock.lastCall ?? [];
      if (!request) throw new Error('missing themed paste preview request');
      pastedPreview.resolve(
        createPreviewResponse(
          request,
          [
            '<h1>Themed heading</h1>',
            '<ul><li>First item</li><li>Second item</li></ul>'
          ].join('') as SafePreviewHtml,
          {}
        )
      );
      await pastedPreview.promise;
    });

    await waitFor(() => {
      expect(visualEditor.querySelector('h1')?.textContent).toBe(
        'Themed heading'
      );
      expect(visualEditor.querySelectorAll('li')).toHaveLength(2);
      expect(visualEditor.getAttribute('aria-busy')).toBe('false');
      expect(visualEditor.getAttribute('contenteditable')).toBe('true');
    });
    expect(visualEditor.textContent).not.toContain('# Themed heading');
    expect(
      visualEditor.classList.contains('easymde-markdown-theme-newsprint')
    ).toBe(true);
  });

  it('renders pasted Markdown through the selected server theme without exposing source text', async () => {
    const pastedPreview = deferred<PreviewResponse>();
    const baseProps = fixture();
    baseProps.submissionField.value = 'Before';
    baseProps.submissionField.defaultValue = 'Before';
    const props = {
      ...baseProps,
      preview: {
        ...baseProps.preview,
        html: '<p>Before</p>' as SafePreviewHtml
      }
    };
    const pastedMarkdown = [
      '',
      '',
      '# Pasted heading',
      '',
      '- First item',
      '- Second item',
      '',
      '**Pasted bold**'
    ].join('\n');
    const expectedMarkdown = `Before${pastedMarkdown}`;
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      request.markdown === expectedMarkdown
        ? pastedPreview.promise
        : Promise.resolve(
            createPreviewResponse(
              request,
              '<p>Before</p>' as SafePreviewHtml,
              {}
            )
          )
    );
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
    fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
    const visualEditor = await view.findByRole('textbox', {
      name: '可视化文章编辑器'
    });
    const paragraph = visualEditor.querySelector('p');
    if (!paragraph?.firstChild) {
      throw new Error('missing visual paste target');
    }
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    const accepted = fireEvent.paste(visualEditor, {
      clipboardData: {
        getData: (type: string) =>
          'text/plain' === type
            ? pastedMarkdown
            : '<h1 onclick="window.__unsafePaste = true">unsafe</h1>'
      }
    });

    expect(accepted).toBe(false);
    expect(props.submissionField.value).toBe(expectedMarkdown);
    expect(visualEditor.textContent).not.toContain('# Pasted heading');
    expect(visualEditor.querySelector('[onclick]')).toBeNull();
    expect(
      visualEditor.classList.contains('easymde-markdown-theme-default')
    ).toBe(true);
    await waitFor(() => {
      const [request, signal] =
        vi.mocked(props.previewPort.render).mock.lastCall ?? [];
      expect(request?.markdown).toBe(expectedMarkdown);
      expect(request?.markdownTheme).toBe('default');
      expect(signal).toBeInstanceOf(AbortSignal);
    });

    await act(async () => {
      const [request] = vi.mocked(props.previewPort.render).mock.lastCall ?? [];
      if (!request) throw new Error('missing pasted preview request');
      pastedPreview.resolve(
        createPreviewResponse(
          request,
          [
            '<p>Before</p>',
            '<h1>Pasted heading</h1>',
            '<ul><li>First item</li><li>Second item</li></ul>',
            '<p><strong>Pasted bold</strong></p>'
          ].join('') as SafePreviewHtml,
          {}
        )
      );
      await pastedPreview.promise;
    });

    await waitFor(() => {
      expect(props.submissionField.value).toBe(expectedMarkdown);
      expect(visualEditor.querySelector('h1')?.textContent).toBe(
        'Pasted heading'
      );
      expect(visualEditor.querySelectorAll('li')).toHaveLength(2);
      expect(visualEditor.querySelector('strong')?.textContent).toBe(
        'Pasted bold'
      );
    });
    expect(visualEditor.textContent).not.toContain('# Pasted heading');
    expect(document.activeElement).toBe(visualEditor);
  });

  it('keeps the visual caret at a middle-document Markdown paste', async () => {
    const pastedPreview = deferred<PreviewResponse>();
    const baseProps = fixture();
    baseProps.submissionField.value = 'Before middle after';
    baseProps.submissionField.defaultValue = 'Before middle after';
    const props = {
      ...baseProps,
      preview: {
        ...baseProps.preview,
        html: '<p>Before middle after</p>' as SafePreviewHtml
      }
    };
    const expectedMarkdown = 'Before **new** after';
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      request.markdown === expectedMarkdown
        ? pastedPreview.promise
        : Promise.resolve(
            createPreviewResponse(
              request,
              '<p>Before middle after</p>' as SafePreviewHtml,
              {}
            )
          )
    );
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
    fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
    const visualEditor = await view.findByRole('textbox', {
      name: '可视化文章编辑器'
    });
    const text = visualEditor.querySelector('p')?.firstChild;
    if (!(text instanceof Text)) {
      throw new Error('missing middle visual paste target');
    }
    const range = document.createRange();
    range.setStart(text, 7);
    range.setEnd(text, 13);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    fireEvent.paste(visualEditor, {
      clipboardData: {
        getData: (type: string) => ('text/plain' === type ? '**new**' : '')
      }
    });
    expect(props.submissionField.value).toBe(expectedMarkdown);

    await act(async () => {
      const [request] = vi.mocked(props.previewPort.render).mock.lastCall ?? [];
      if (!request) throw new Error('missing middle paste preview request');
      pastedPreview.resolve(
        createPreviewResponse(
          request,
          '<p>Before <strong>new</strong> after</p>' as SafePreviewHtml,
          {}
        )
      );
      await pastedPreview.promise;
    });
    await waitFor(() =>
      expect(visualEditor.getAttribute('contenteditable')).toBe('true')
    );

    const liveSelection = window.getSelection();
    expect(liveSelection?.isCollapsed).toBe(true);
    const liveRange = liveSelection?.getRangeAt(0);
    if (!liveRange) throw new Error('missing restored visual paste caret');
    const punctuation = document.createTextNode('!');
    liveRange.insertNode(punctuation);
    liveRange.setStartAfter(punctuation);
    liveRange.collapse(true);
    liveSelection?.removeAllRanges();
    liveSelection?.addRange(liveRange);
    fireEvent.input(visualEditor);

    await waitFor(() =>
      expect(props.submissionField.value).toBe('Before **new**! after')
    );
  });

  it('parses consecutive full Markdown pastes through one server Preview request each', async () => {
    const baseProps = fixture();
    baseProps.submissionField.value = 'Before';
    baseProps.submissionField.defaultValue = 'Before';
    const props = {
      ...baseProps,
      preview: {
        ...baseProps.preview,
        html: '<p>Before</p>' as SafePreviewHtml
      }
    };
    const firstPaste = '\n\n# Pasted heading\n\n**Pasted bold**';
    const secondPaste = '\n\n- First item\n- Second item\n\n`inline`';
    const firstMarkdown = `Before${firstPaste}`;
    const secondMarkdown = `${firstMarkdown}${secondPaste}`;
    vi.mocked(props.previewPort.render).mockImplementation((request) => {
      if (request.markdown === firstMarkdown) {
        return Promise.resolve(
          createPreviewResponse(
            request,
            [
              '<p>Before</p>',
              '<h1>Pasted heading</h1>',
              '<p><strong>Pasted bold</strong></p>'
            ].join('') as SafePreviewHtml,
            {}
          )
        );
      }
      if (request.markdown === secondMarkdown) {
        return Promise.resolve(
          createPreviewResponse(
            request,
            [
              '<p>Before</p>',
              '<h1>Pasted heading</h1>',
              '<p><strong>Pasted bold</strong></p>',
              '<ul><li>First item</li><li>Second item</li></ul>',
              '<p><code>inline</code></p>'
            ].join('') as SafePreviewHtml,
            {}
          )
        );
      }
      return Promise.resolve(
        createPreviewResponse(request, '<p>Before</p>' as SafePreviewHtml, {})
      );
    });
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
    fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
    const visualEditor = await view.findByRole('textbox', {
      name: '可视化文章编辑器'
    });
    const setCaretAtEnd = () => {
      const range = document.createRange();
      range.selectNodeContents(visualEditor);
      range.collapse(false);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    };

    setCaretAtEnd();
    fireEvent.paste(visualEditor, {
      clipboardData: {
        getData: (type: string) =>
          'text/plain' === type ? firstPaste : '<h1>unsafe</h1>'
      }
    });
    await waitFor(() => {
      expect(props.submissionField.value).toBe(firstMarkdown);
      expect(visualEditor.querySelector('h1')?.textContent).toBe(
        'Pasted heading'
      );
      expect(visualEditor.querySelector('strong')?.textContent).toBe(
        'Pasted bold'
      );
    });

    setCaretAtEnd();
    fireEvent.paste(visualEditor, {
      clipboardData: {
        getData: (type: string) =>
          'text/plain' === type ? secondPaste : '<ul><li>unsafe</li></ul>'
      }
    });
    await waitFor(() => {
      expect(props.submissionField.value).toBe(secondMarkdown);
      expect(visualEditor.querySelectorAll('li')).toHaveLength(2);
      expect(visualEditor.querySelector('code')?.textContent).toBe('inline');
    });

    expect(
      vi
        .mocked(props.previewPort.render)
        .mock.calls.filter(([request]) => request.markdown === firstMarkdown)
    ).toHaveLength(1);
    expect(
      vi
        .mocked(props.previewPort.render)
        .mock.calls.filter(([request]) => request.markdown === secondMarkdown)
    ).toHaveLength(1);
    expect(visualEditor.textContent).not.toContain('# Pasted heading');
    expect(visualEditor.textContent).not.toContain('**Pasted bold**');
  });

  it('keeps visual keystrokes local without a Preview request per input', async () => {
    const baseProps = fixture();
    baseProps.submissionField.value = 'Before';
    baseProps.submissionField.defaultValue = 'Before';
    const props = {
      ...baseProps,
      preview: {
        ...baseProps.preview,
        html: '<p>Before</p>' as SafePreviewHtml
      }
    };
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      Promise.resolve(
        createPreviewResponse(request, '<p>Before</p>' as SafePreviewHtml, {})
      )
    );
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
    fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
    const visualEditor = await view.findByRole('textbox', {
      name: '可视化文章编辑器'
    });
    const renderCallsBeforeInput = vi.mocked(props.previewPort.render).mock
      .calls.length;
    const selection = window.getSelection();

    for (const value of ['Typed one', 'Typed two', 'Typed three']) {
      visualEditor.innerHTML = `<p>${value}</p>`;
      const paragraph = visualEditor.querySelector('p');
      if (!paragraph) throw new Error('visual-typing-paragraph-missing');
      const range = document.createRange();
      range.selectNodeContents(paragraph);
      range.collapse(false);
      selection?.removeAllRanges();
      selection?.addRange(range);
      fireEvent.input(visualEditor);
    }

    await waitFor(() =>
      expect(props.submissionField.value).toBe('Typed three')
    );
    expect(vi.mocked(props.previewPort.render).mock.calls.length).toBe(
      renderCallsBeforeInput
    );
    view.unmount();
  });

  it('keeps a committed visual paste editable when caret restoration is unavailable', async () => {
    const pastedPreview = deferred<PreviewResponse>();
    const baseProps = fixture();
    baseProps.submissionField.value = 'Before';
    baseProps.submissionField.defaultValue = 'Before';
    const props = {
      ...baseProps,
      preview: {
        ...baseProps.preview,
        html: '<p>Before</p>' as SafePreviewHtml
      }
    };
    const pastedMarkdown = ' **new**';
    const expectedMarkdown = `Before${pastedMarkdown}`;
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      request.markdown === expectedMarkdown
        ? pastedPreview.promise
        : Promise.resolve(
            createPreviewResponse(
              request,
              '<p>Before</p>' as SafePreviewHtml,
              {}
            )
          )
    );
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
    fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
    const visualEditor = await view.findByRole('textbox', {
      name: '可视化文章编辑器'
    });
    const paragraph = visualEditor.querySelector('p');
    if (!paragraph) throw new Error('missing visual paste target');
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    fireEvent.paste(visualEditor, {
      clipboardData: {
        getData: (type: string) => ('text/plain' === type ? pastedMarkdown : '')
      }
    });
    expect(props.submissionField.value).toBe(expectedMarkdown);

    const getSelection = vi.spyOn(window, 'getSelection').mockReturnValue(null);
    await act(async () => {
      const [request] = vi.mocked(props.previewPort.render).mock.lastCall ?? [];
      if (!request)
        throw new Error('missing unavailable-caret preview request');
      pastedPreview.resolve(
        createPreviewResponse(
          request,
          '<p>Before <strong>new</strong></p>' as SafePreviewHtml,
          {}
        )
      );
      await pastedPreview.promise;
    });
    getSelection.mockRestore();

    await waitFor(() =>
      expect(visualEditor.getAttribute('contenteditable')).toBe('true')
    );
    expect(visualEditor.querySelector('strong')?.textContent).toBe('new');
    expect(props.onFailure).toHaveBeenCalledWith(
      'visual-editor-selection-unavailable'
    );
    expect(view.queryByText(props.preview.messages.error)).toBeNull();
  });

  it('leaves visual editing and preserves canonical Markdown when pasted Preview rendering fails', async () => {
    const baseProps = fixture();
    baseProps.submissionField.value = 'Before';
    baseProps.submissionField.defaultValue = 'Before';
    const props = {
      ...baseProps,
      preview: {
        ...baseProps.preview,
        html: '<p>Before</p>' as SafePreviewHtml
      }
    };
    const pastedMarkdown = ' **new**';
    const expectedMarkdown = 'Before **new**';
    let pastedPreviewRequests = 0;
    vi.mocked(props.previewPort.render).mockImplementation((request) => {
      if (request.markdown !== expectedMarkdown) {
        return Promise.resolve(
          createPreviewResponse(request, '<p>Before</p>' as SafePreviewHtml, {})
        );
      }
      pastedPreviewRequests += 1;
      return 1 === pastedPreviewRequests
        ? Promise.reject(new Error('synthetic-preview-failure'))
        : Promise.resolve(
            createPreviewResponse(
              request,
              '<p>Before <strong>new</strong></p>' as SafePreviewHtml,
              {}
            )
          );
    });
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
    fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
    const visualEditor = await view.findByRole('textbox', {
      name: '可视化文章编辑器'
    });
    const paragraph = visualEditor.querySelector('p');
    if (!paragraph) throw new Error('missing failed visual paste target');
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    fireEvent.paste(visualEditor, {
      clipboardData: {
        getData: (type: string) => ('text/plain' === type ? pastedMarkdown : '')
      }
    });

    expect(props.submissionField.value).toBe(expectedMarkdown);
    await waitFor(() =>
      expect(
        view.queryByRole('textbox', { name: '可视化文章编辑器' })
      ).toBeNull()
    );
    await waitFor(() => {
      const preview = view.container.querySelector<HTMLElement>(
        '[data-easymde-preview-html-sink]'
      );
      expect(preview?.querySelector('strong')?.textContent).toBe('new');
    });
    expect(pastedPreviewRequests).toBe(2);
    expect(props.onFailure).toHaveBeenCalledWith(
      'visual-editor-markdown-paste-render-failed'
    );
  });

  it('allows locking during a pending Markdown render and ignores its late response', async () => {
    const pendingPreview = deferred<PreviewResponse>();
    const baseProps = fixture();
    baseProps.submissionField.value = 'Before';
    baseProps.submissionField.defaultValue = 'Before';
    const props = {
      ...baseProps,
      preview: {
        ...baseProps.preview,
        html: '<p>Before</p>' as SafePreviewHtml
      }
    };
    const expectedMarkdown = 'Before\n\n# Pending';
    let pendingRequestCount = 0;
    vi.mocked(props.previewPort.render).mockImplementation((request) => {
      if (request.markdown !== expectedMarkdown) {
        return Promise.resolve(
          createPreviewResponse(request, '<p>Before</p>' as SafePreviewHtml, {})
        );
      }
      pendingRequestCount += 1;
      return 1 === pendingRequestCount
        ? pendingPreview.promise
        : Promise.resolve(
            createPreviewResponse(
              request,
              '<p>Before</p><h1>Pending</h1>' as SafePreviewHtml,
              {}
            )
          );
    });
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
    fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
    const visualEditor = await view.findByRole('textbox', {
      name: '可视化文章编辑器'
    });
    const paragraph = visualEditor.querySelector('p');
    if (!paragraph) throw new Error('missing pending paste target');
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    fireEvent.paste(visualEditor, {
      clipboardData: {
        getData: (type: string) =>
          'text/plain' === type ? '\n\n# Pending' : ''
      }
    });
    expect(props.submissionField.value).toBe(expectedMarkdown);
    expect(visualEditor.getAttribute('contenteditable')).toBe('true');
    const lock = view.getByRole('button', { name: '锁定为只读' });
    expect(lock.hasAttribute('disabled')).toBe(false);
    fireEvent.click(lock);

    await waitFor(() =>
      expect(
        view.queryByRole('textbox', { name: '可视化文章编辑器' })
      ).toBeNull()
    );
    const lockedPreview = view.container.querySelector<HTMLElement>(
      '[data-easymde-preview-html-sink]'
    );
    expect(lockedPreview?.getAttribute('contenteditable')).toBeNull();
    expect(lockedPreview?.getAttribute('role')).toBeNull();
    expect(lockedPreview?.getAttribute('aria-label')).toBeNull();
    expect(lockedPreview?.getAttribute('spellcheck')).toBeNull();

    await act(async () => {
      const [request] = vi.mocked(props.previewPort.render).mock.lastCall ?? [];
      if (!request) throw new Error('missing stale pending preview request');
      pendingPreview.resolve(
        createPreviewResponse(
          request,
          '<h1>Stale pending response</h1>' as SafePreviewHtml,
          {}
        )
      );
      await pendingPreview.promise;
    });
    expect(view.queryByText('Stale pending response')).toBeNull();
    expect(props.submissionField.value).toBe(expectedMarkdown);
    expect(
      view.queryByRole('textbox', { name: '可视化文章编辑器' })
    ).toBeNull();
  });

  it('leaves visual editing before an external canonical change can be overwritten', async () => {
    const props = fixture();
    props.submissionField.value = 'Before';
    props.submissionField.defaultValue = 'Before';
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      Promise.resolve(
        createPreviewResponse(request, '<p>Before</p>' as SafePreviewHtml, {})
      )
    );
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
    fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
    const staleVisualEditor = await view.findByRole('textbox', {
      name: '可视化文章编辑器'
    });

    props.submissionField.value = 'External canonical update';
    fireEvent.input(props.submissionField);

    await waitFor(() =>
      expect(
        view.queryByRole('textbox', { name: '可视化文章编辑器' })
      ).toBeNull()
    );
    expect(props.onFailure).toHaveBeenCalledWith(
      'visual-editor-canonical-document-changed'
    );
    staleVisualEditor.innerHTML = '<p>Stale visual overwrite</p>';
    fireEvent.input(staleVisualEditor);
    expect(props.submissionField.value).toBe('External canonical update');
  });

  it('restores the last valid paper when a visual edit cannot map safely', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
    fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
    const visualEditor = await view.findByRole('textbox', {
      name: '可视化文章编辑器'
    });
    expect(visualEditor.textContent).toBe('Rendered');

    visualEditor.innerHTML = '<p>Unmapped replacement</p>';
    fireEvent.input(visualEditor);

    await waitFor(() => {
      expect(props.submissionField.value).toBe('selected');
      expect(visualEditor.textContent).toBe('Rendered');
      expect(props.onFailure).toHaveBeenCalledWith(
        'visual-editor-markdown-merge-failed'
      );
    });
    expect(
      view.container.querySelector(
        '.easymde-immersive-preview-status .is-error'
      )
    ).toBeNull();
  });

  it('reports visual sync failures without changing the authoritative Preview status', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
    fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
    const visualEditor = await view.findByRole('textbox', {
      name: '可视化文章编辑器'
    });

    visualEditor.innerHTML = '<p>Unmapped replacement</p>';
    fireEvent.input(visualEditor);

    await waitFor(() =>
      expect(props.onFailure).toHaveBeenCalledWith(
        'visual-editor-markdown-merge-failed'
      )
    );
    expect(
      view.container.querySelector(
        '.easymde-immersive-preview-status .is-error'
      )
    ).toBeNull();
    expect(
      view.container.querySelector('[data-easymde-preview-error="1"]')
    ).toBeNull();
    expect(view.getByRole('textbox', { name: '可视化文章编辑器' })).toBe(
      visualEditor
    );
  });

  it('preserves the plain visual paste path for a remote image when image hosting is disabled', async () => {
    const baseProps = fixture();
    const props = {
      ...baseProps,
      imageUpload: { ...baseProps.imageUpload, enabled: false }
    };
    props.submissionField.value = 'Before';
    props.submissionField.defaultValue = 'Before';
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      Promise.resolve(
        createPreviewResponse(
          request,
          'Before **safe** dropped' === request.markdown
            ? ('<p>Before <strong>safe</strong> dropped</p>' as SafePreviewHtml)
            : 'Before **safe**' === request.markdown
              ? ('<p>Before <strong>safe</strong></p>' as SafePreviewHtml)
              : ('<p>Before</p>' as SafePreviewHtml),
          {}
        )
      )
    );
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
    fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
    const visualEditor = await view.findByRole('textbox', {
      name: '可视化文章编辑器'
    });
    const text = visualEditor.querySelector('p')?.firstChild;
    if (!text) throw new Error('missing synthetic paste target');
    const range = document.createRange();
    range.selectNodeContents(text);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    const accepted = fireEvent.paste(visualEditor, {
      clipboardData: {
        getData: (type: string) =>
          'text/plain' === type
            ? ' **safe**'
            : '<img alt="remote" src="https://images.example.test/remote.png">'
      }
    });

    expect(accepted).toBe(false);
    expect(visualEditor.querySelector('img')).toBeNull();
    await waitFor(() =>
      expect(props.submissionField.value).toBe('Before **safe**')
    );
    expect(props.remoteImageImportPort.import).not.toHaveBeenCalled();

    const paragraph = visualEditor.querySelector('p');
    if (!paragraph) throw new Error('missing synthetic drop target');
    range.selectNodeContents(paragraph);
    range.collapse(false);
    selection?.removeAllRanges();
    selection?.addRange(range);
    const dropped = fireEvent.drop(visualEditor, {
      dataTransfer: {
        getData: (type: string) =>
          'text/plain' === type
            ? ' dropped'
            : '<img src="x" onerror="window.__unsafeDrop = true">'
      }
    });

    expect(dropped).toBe(false);
    expect(visualEditor.querySelector('img')).toBeNull();
    await waitFor(() =>
      expect(props.submissionField.value).toBe('Before **safe** dropped')
    );
  });

  it.each(['paste', 'drop'] as const)(
    'routes visual Preview image %s through the WordPress upload owner',
    async (source) => {
      const props = fixture();
      props.submissionField.value = 'Before **selected** after';
      props.submissionField.defaultValue = 'Before **selected** after';
      vi.mocked(props.previewPort.render).mockImplementation((request) =>
        Promise.resolve(
          createPreviewResponse(
            request,
            '<p>Before <strong>selected</strong> after</p>' as SafePreviewHtml,
            {}
          )
        )
      );
      const view = render(<EditorRoot {...props} />);

      fireEvent.click(
        await view.findByRole('button', { name: '进入沉浸写作' })
      );
      fireEvent.click(view.getByRole('button', { name: '预览' }));
      await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
      fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
      const visualEditor = await view.findByRole('textbox', {
        name: '可视化文章编辑器'
      });
      const selectedText = visualEditor.querySelector('strong')?.firstChild;
      if (!selectedText) {
        throw new Error('missing synthetic visual image-paste target');
      }
      const range = document.createRange();
      range.selectNodeContents(selectedText);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      const transfer = imageTransferEvent(
        source,
        new File(['image'], 'visual.png', { type: 'image/png' })
      );

      visualEditor.dispatchEvent(transfer);

      expect(transfer.defaultPrevented).toBe(true);
      await waitFor(() => {
        expect(props.imageUploadPort.upload).toHaveBeenCalledTimes(1);
        expect(props.submissionField.value).toBe(
          'Before **![visual](https://example.test/upload.png)** after'
        );
      });
      expect(
        view.queryByRole('textbox', { name: '可视化文章编辑器' })
      ).toBeNull();
      const messageHost = view.container.querySelector(
        '.easymde-editor-message-alert-host'
      );
      expect(messageHost).not.toBeNull();
      expect(
        within(messageHost as HTMLElement).getByRole('status').textContent
      ).toContain('paste' === source ? 'Paste uploaded' : 'Drop uploaded');
    }
  );

  it.each(['paste', 'drop'] as const)(
    'fails visual image %s without a valid selection before starting the Media owner',
    async (source) => {
      const props = fixture();
      props.submissionField.value = 'Before **selected** after';
      props.submissionField.defaultValue = 'Before **selected** after';
      vi.mocked(props.previewPort.render).mockImplementation((request) =>
        Promise.resolve(
          createPreviewResponse(
            request,
            '<p>Before <strong>selected</strong> after</p>' as SafePreviewHtml,
            {}
          )
        )
      );
      const view = render(<EditorRoot {...props} />);

      fireEvent.click(
        await view.findByRole('button', { name: '进入沉浸写作' })
      );
      fireEvent.click(view.getByRole('button', { name: '预览' }));
      await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
      fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
      const visualEditor = await view.findByRole('textbox', {
        name: '可视化文章编辑器'
      });
      const getSelection = vi
        .spyOn(window, 'getSelection')
        .mockReturnValue(null);
      const transfer = imageTransferEvent(
        source,
        new File(['image'], 'visual.png', { type: 'image/png' })
      );

      try {
        visualEditor.dispatchEvent(transfer);

        expect(transfer.defaultPrevented).toBe(true);
        expect(props.imageUploadPort.upload).not.toHaveBeenCalled();
        expect(props.submissionField.value).toBe('Before **selected** after');
        expect(
          view.getByRole('textbox', {
            name: '可视化文章编辑器'
          })
        ).toBe(visualEditor);
        await waitFor(() =>
          expect(props.onFailure).toHaveBeenCalledWith(
            'visual-editor-selection-unavailable'
          )
        );
      } finally {
        getSelection.mockRestore();
        view.unmount();
      }
    }
  );

  it('completes a deferred remote image import after visual editing switches to read-only', async () => {
    const props = fixture();
    props.submissionField.value = 'Before **selected** after';
    props.submissionField.defaultValue = 'Before **selected** after';
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      Promise.resolve(
        createPreviewResponse(
          request,
          '<p>Before <strong>selected</strong> after</p>' as SafePreviewHtml,
          {}
        )
      )
    );
    let resolveImport: (result: RemoteImageImportResult) => void = () =>
      undefined;
    vi.mocked(props.remoteImageImportPort.import).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveImport = resolve;
        })
    );
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
    fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
    const visualEditor = await view.findByRole('textbox', {
      name: '可视化文章编辑器'
    });
    const selectedText = visualEditor.querySelector('strong')?.firstChild;
    if (!selectedText) throw new Error('missing remote image paste target');
    const range = document.createRange();
    range.selectNodeContents(selectedText);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    const paste = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(paste, 'clipboardData', {
      value: {
        files: [],
        getData: (type: string) =>
          'text/html' === type
            ? '<img alt="remote" src="https://images.example.test/remote.png">'
            : '',
        items: []
      }
    });

    visualEditor.dispatchEvent(paste);

    expect(paste.defaultPrevented).toBe(true);
    await waitFor(() => {
      expect(props.remoteImageImportPort.import).toHaveBeenCalledOnce();
    });

    await waitFor(() => {
      expect(props.submissionField.value).toBe(
        'Before **![remote](https://images.example.test/remote.png)** after'
      );
    });
    expect(view.getByRole('button', { name: '解除锁定并编辑' })).not.toBeNull();
    expect(
      vi.mocked(props.remoteImageImportPort.import).mock.calls[0]?.[0].signal
        .aborted
    ).toBe(false);
    resolveImport({
      alt: 'remote',
      backup: { status: 'disabled' },
      status: 'imported',
      title: '',
      url: 'https://example.test/imported.png'
    });
    await waitFor(() => {
      expect(props.submissionField.value).toBe(
        'Before **![remote](https://example.test/imported.png)** after'
      );
    });
    expect(props.onFailure).not.toHaveBeenCalledWith(
      'remote-image-import-completed-after-teardown'
    );
  });

  it('remounts the Preview owner before applying a theme from visual Preview', async () => {
    const props = fixture();
    props.submissionField.value = 'Rendered';
    props.submissionField.defaultValue = 'Rendered';
    const view = render(<EditorRoot {...props} />);
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
    fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
    await view.findByRole('textbox', { name: '可视化文章编辑器' });
    const renderPreview = vi.mocked(props.previewPort.render);
    const renderCount = renderPreview.mock.calls.length;

    fireEvent.click(view.getByRole('button', { name: '主题' }));
    fireEvent.click(view.getByRole('button', { name: 'Article theme' }));
    fireEvent.click(view.getByRole('option', { name: 'Newsprint' }));

    await waitFor(() => {
      expect(props.appearancePort.applyState).toHaveBeenCalledWith(
        expect.objectContaining({ markdownTheme: 'newsprint' }),
        false
      );
      expect(
        view.queryByRole('textbox', { name: '可视化文章编辑器' })
      ).toBeNull();
    });
    await waitFor(() => {
      expect(renderPreview.mock.calls.length).toBeGreaterThan(renderCount);
      expect(renderPreview).toHaveBeenLastCalledWith(
        expect.objectContaining({ markdownTheme: 'newsprint' }),
        expect.any(AbortSignal)
      );
    });
    expect(
      view.container
        .querySelector('[data-easymde-preview-html-sink]')
        ?.classList.contains('easymde-markdown-theme-newsprint')
    ).toBe(true);
  });

  it('keeps the visible article theme unchanged until its stylesheet is ready', async () => {
    const props = fixture();
    const pending = deferred<boolean>();
    vi.mocked(props.appearancePort.applyState).mockReturnValueOnce(
      pending.promise
    );
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(await view.findByRole('button', { name: '编辑器设置' }));
    fireEvent.click(view.getByRole('combobox', { name: 'Article theme' }));
    fireEvent.click(view.getByRole('option', { name: 'Newsprint' }));

    expect(
      view.container
        .querySelector('[data-easymde-preview-html-sink]')
        ?.classList.contains('easymde-markdown-theme-default')
    ).toBe(true);
    expect(
      view.container
        .querySelector('[data-easymde-preview-html-sink]')
        ?.classList.contains('easymde-markdown-theme-newsprint')
    ).toBe(false);

    pending.resolve(true);

    await waitFor(() =>
      expect(
        view.container
          .querySelector('[data-easymde-preview-html-sink]')
          ?.classList.contains('easymde-markdown-theme-newsprint')
      ).toBe(true)
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(view.getByRole('button', { name: '进入沉浸写作' }));
    expect(view.getByText('未保存')).not.toBeNull();
  });

  it.each([
    { control: 'Article theme', option: 'Newsprint' },
    { control: 'Code theme', option: 'GitHub' }
  ])(
    'blocks native submission and autosave until the pending $control transaction settles',
    async ({ control, option }) => {
      const props = fixture();
      const pending = deferred<boolean>();
      vi.mocked(props.appearancePort.applyState).mockReturnValueOnce(
        pending.promise
      );
      const view = render(<EditorRoot {...props} />);

      fireEvent.click(
        await view.findByRole('button', {
          name: '编辑器设置'
        })
      );
      fireEvent.click(view.getByRole('combobox', { name: control }));
      fireEvent.click(view.getByRole('option', { name: option }));

      const pendingSubmit = new SubmitEvent('submit', {
        bubbles: true,
        cancelable: true
      });
      expect(props.nativeForm.dispatchEvent(pendingSubmit)).toBe(false);
      expect(props.sessionAutosave()).toBe('blocked');
      expect(props.onFailure).toHaveBeenCalledWith('editor-appearance-pending');

      pending.resolve(true);
      await waitFor(() => {
        expect(props.appearancePort.applyState).toHaveResolvedTimes(1);
      });

      const settledSubmit = new SubmitEvent('submit', {
        bubbles: true,
        cancelable: true
      });
      expect(props.nativeForm.dispatchEvent(settledSubmit)).toBe(true);
      expect(props.sessionAutosave()).toBe('continue');
    }
  );

  it('synchronizes a committed pending theme into Appearance after a mode remount', async () => {
    const props = fixture();
    const pending = deferred<boolean>();
    vi.mocked(props.appearancePort.applyState).mockReturnValueOnce(
      pending.promise
    );
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(await view.findByRole('button', { name: '编辑器设置' }));
    fireEvent.click(view.getByRole('combobox', { name: 'Article theme' }));
    fireEvent.click(view.getByRole('option', { name: 'Newsprint' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(view.getByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '主题' }));

    expect(
      view.getByRole('button', { name: 'Article theme' }).textContent
    ).toContain('Default');

    pending.resolve(true);

    await waitFor(() =>
      expect(
        view.getByRole('button', { name: 'Article theme' }).textContent
      ).toContain('Newsprint')
    );
  });

  it('reports a pending appearance failure after its initiating control remounts', async () => {
    const props = fixture();
    const pending = deferred<boolean>();
    vi.mocked(props.appearancePort.applyState).mockReturnValueOnce(
      pending.promise
    );
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(await view.findByRole('button', { name: '编辑器设置' }));
    fireEvent.click(view.getByRole('combobox', { name: 'Article theme' }));
    fireEvent.click(view.getByRole('option', { name: 'Newsprint' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(view.getByRole('button', { name: '进入沉浸写作' }));

    pending.reject(
      new Error('appearance-article-theme-stylesheet-load-failed')
    );

    await waitFor(() =>
      expect(props.onFailure).toHaveBeenCalledWith(
        'react-editor-appearance-failed'
      )
    );
  });

  it('rejects explicit code-theme intent when visual Preview cannot synchronize', async () => {
    const props = fixture();
    const codeThemeExplicitField = document.createElement('input');
    codeThemeExplicitField.value = '0';
    const appearance = {
      ...props.appearance,
      codeThemes: [
        ...props.appearance.codeThemes,
        { id: 'terminal-noir', label: 'Terminal Noir' }
      ]
    };
    vi.mocked(props.appearancePort.applyState).mockImplementation(
      async (_state, explicit) => {
        codeThemeExplicitField.value = explicit ? '1' : '0';
        return true;
      }
    );
    const view = render(<EditorRoot {...props} appearance={appearance} />);
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
    fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
    const visualEditor = await view.findByRole('textbox', {
      name: '可视化文章编辑器'
    });
    visualEditor.innerHTML = '<div class="easymde-mermaid"></div>';

    fireEvent.click(view.getByRole('button', { name: '主题' }));
    const codeTheme = view.getByRole('button', { name: 'Code theme' });
    fireEvent.click(codeTheme);
    fireEvent.click(view.getByRole('option', { name: 'Terminal Noir' }));

    expect(props.appearancePort.applyState).not.toHaveBeenCalled();
    expect(codeThemeExplicitField.value).toBe('0');
    await waitFor(() =>
      expect(codeTheme.textContent).toContain('Atom One Dark')
    );
  });

  it('rejects a saved Custom CSS snapshot when visual Preview cannot synchronize', async () => {
    const props = fixture();
    vi.mocked(props.appearancePort.saveCustomCss).mockResolvedValue({
      status: 'saved',
      snapshot: {
        customCss: [
          {
            id: 'saved-css',
            articleThemeName: 'Saved Article',
            codeThemeName: 'Saved Code',
            css: '.saved { color: green; }',
            scopedCss: '.easymde-rendered-content .saved { color: green; }'
          }
        ],
        state: {
          markdownTheme: 'custom',
          codeTheme: 'atom-one-dark',
          customCssId: 'saved-css'
        }
      }
    });
    const view = render(<EditorRoot {...props} />);
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
    fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
    const visualEditor = await view.findByRole('textbox', {
      name: '可视化文章编辑器'
    });
    visualEditor.innerHTML = '<div class="easymde-mermaid"></div>';

    fireEvent.click(view.getByRole('button', { name: '主题' }));
    fireEvent.click(view.getByRole('button', { name: 'Custom CSS theme' }));
    fireEvent.click(view.getByRole('button', { name: 'Apply theme' }));

    await view.findByText('CSS save failed');
    expect(props.appearancePort.saveCustomCss).not.toHaveBeenCalled();
    expect(props.appearancePort.applyState).not.toHaveBeenCalled();
    expect(props.onFailure).toHaveBeenCalledWith(
      'react-editor-appearance-failed'
    );
    expect(view.queryByText('CSS saved')).toBeNull();
  });

  it('keeps the Preview owner and paper alive when entering Preview mode', async () => {
    const firstPreview = deferred<PreviewResponse>();
    const props = fixture();
    let firstPreviewRequest: PreviewRequest | null = null;
    vi.mocked(props.previewPort.render).mockImplementationOnce((request) => {
      firstPreviewRequest = request;
      return firstPreview.promise;
    });
    const view = render(<EditorRoot {...props} />);

    await waitFor(() =>
      expect(props.previewPort.render).toHaveBeenCalledTimes(1)
    );
    const previewOwner = view.container.querySelector(
      '[data-easymde-preview-html-sink]'
    );
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));

    expect(props.previewPort.render).toHaveBeenCalledTimes(1);
    expect(
      view.container.querySelector('[data-easymde-preview-html-sink]')
    ).toBe(previewOwner);
    expect(
      view
        .getByRole('button', { name: '解除锁定并编辑' })
        .hasAttribute('disabled')
    ).toBe(true);
    await act(async () => {
      if (!firstPreviewRequest)
        throw new Error('missing first preview request');
      firstPreview.resolve(
        createPreviewResponse(
          firstPreviewRequest,
          '<p>Current Preview</p>' as SafePreviewHtml,
          {}
        )
      );
    });
    await waitFor(() => {
      expect(view.getByText('Current Preview')).not.toBeNull();
      expect(view.getByText('内容已载入')).not.toBeNull();
    });
    expect(
      view
        .getByRole('button', { name: '解除锁定并编辑' })
        .hasAttribute('disabled')
    ).toBe(false);

    expect(view.getByText('Current Preview')).not.toBeNull();
  });

  it('keeps the selected article theme while Preview is locked and editable', async () => {
    const baseProps = fixture();
    const props = {
      ...baseProps,
      appearance: {
        ...baseProps.appearance,
        state: {
          ...baseProps.appearance.state,
          markdownTheme: 'newsprint'
        }
      }
    };
    const view = render(<EditorRoot {...props} />);

    await waitFor(() =>
      expect(props.previewPort.render).toHaveBeenLastCalledWith(
        expect.objectContaining({ markdownTheme: 'newsprint' }),
        expect.any(AbortSignal)
      )
    );

    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));

    await waitFor(() =>
      expect(props.previewPort.render).toHaveBeenLastCalledWith(
        expect.objectContaining({ markdownTheme: 'newsprint' }),
        expect.any(AbortSignal)
      )
    );
    const lockedPreview = view.container.querySelector(
      '[data-easymde-preview-html-sink]'
    );
    expect(
      lockedPreview?.classList.contains('easymde-markdown-theme-newsprint')
    ).toBe(true);
    expect(
      lockedPreview?.classList.contains('easymde-immersive-reference-prose')
    ).toBe(false);

    fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
    const visualEditor = await view.findByRole('textbox', {
      name: '可视化文章编辑器'
    });
    expect(visualEditor).not.toBeNull();
    expect(
      visualEditor.classList.contains('easymde-markdown-theme-newsprint')
    ).toBe(true);
    expect(props.previewPort.render).toHaveBeenLastCalledWith(
      expect.objectContaining({ markdownTheme: 'newsprint' }),
      expect.any(AbortSignal)
    );

    fireEvent.click(view.getByRole('button', { name: '编辑' }));
    await waitFor(() =>
      expect(props.previewPort.render).toHaveBeenLastCalledWith(
        expect.objectContaining({ markdownTheme: 'newsprint' }),
        expect.any(AbortSignal)
      )
    );
  });

  it('keeps enhanced generated blocks visible and lossless while visual text is edited', async () => {
    const source = [
      'Editable paragraph',
      '',
      '$$',
      'x^2',
      '$$',
      '',
      '```mermaid',
      'flowchart TD',
      'A-->B',
      '```'
    ].join('\n');
    const props = fixture();
    props.submissionField.value = source;
    props.submissionField.defaultValue = source;
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      Promise.resolve(
        createPreviewResponse(
          request,
          [
            '<p>Editable paragraph</p>',
            '<div class="easymde-math easymde-math-block">$$x^2$$</div>',
            '<pre><code class="language-mermaid">flowchart TD\nA--&gt;B</code></pre>',
            '<section class="footnotes-sep">References</section>',
            '<section class="footnotes">Generated footnotes</section>'
          ].join('') as SafePreviewHtml,
          { math: true, mermaid: true }
        )
      )
    );
    vi.mocked(props.enhancementPort.enhance).mockImplementation(
      async (surface) => {
        const math = surface.querySelector<HTMLElement>('.easymde-math');
        if (math) {
          math.innerHTML = '<span class="katex">rendered math</span>';
          math.dataset.easymdeRendered = '1';
        }
        const mermaid = surface.querySelector(
          'pre:has(> code.language-mermaid)'
        );
        mermaid?.replaceWith(
          Object.assign(document.createElement('div'), {
            className: 'easymde-mermaid',
            innerHTML: '<svg><text>rendered diagram</text></svg>'
          })
        );
      }
    );
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
    fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));

    const visualEditor = await view.findByRole('textbox', {
      name: '可视化文章编辑器'
    });
    expect(visualEditor.querySelector('.katex')?.textContent).toBe(
      'rendered math'
    );
    expect(visualEditor.querySelector('.easymde-mermaid svg')).not.toBeNull();
    for (const region of visualEditor.querySelectorAll(
      '.easymde-math, .easymde-mermaid, .footnotes-sep, .footnotes'
    )) {
      expect(region.getAttribute('contenteditable')).toBe('false');
    }

    const paragraph = visualEditor.querySelector('p');
    if (!paragraph) throw new Error('missing synthetic visual paragraph');
    paragraph.textContent = 'Edited paragraph';
    fireEvent.input(visualEditor);

    await waitFor(() =>
      expect(props.submissionField.value).toBe(
        source.replace('Editable paragraph', 'Edited paragraph')
      )
    );
  });

  it('copies the active visual Preview after an unlocked Markdown edit', async () => {
    const props = fixture();
    props.submissionField.value = 'Original paragraph';
    props.submissionField.defaultValue = 'Original paragraph';
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      Promise.resolve(
        createPreviewResponse(
          request,
          '<p>Original paragraph</p>' as SafePreviewHtml,
          {}
        )
      )
    );
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
    fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
    const visualEditor = await view.findByRole('textbox', {
      name: '可视化文章编辑器'
    });
    const paragraph = visualEditor.querySelector('p');
    if (!paragraph) throw new Error('missing visual copy test paragraph');
    paragraph.textContent = 'Edited paragraph';
    const prepare = props.wechatClipboard.prepare;
    if (!prepare) throw new Error('wechat preparation is unavailable');
    const preparation = vi.mocked(prepare);
    const preparationCallsBeforeEdit = preparation.mock.calls.length;
    fireEvent.input(visualEditor);

    fireEvent.click(view.getByRole('button', { name: '复制到公众号' }));

    await waitFor(() =>
      expect(props.wechatClipboard.copy).toHaveBeenCalledOnce()
    );
    expect(props.wechatClipboard.copy).toHaveBeenCalledWith(
      visualEditor,
      expect.objectContaining({
        pngConversionEnabled: false,
        postId: props.imageUpload.postId,
        maxBytes: props.imageUpload.maxBytes
      })
    );
    expect(preparation.mock.calls.length).toBe(preparationCallsBeforeEdit);
    await waitFor(() =>
      expect(props.submissionField.value).toBe('Edited paragraph')
    );
  });

  it('does not prepare WeChat during an active visual Preview edit', async () => {
    const props = fixture();
    props.submissionField.value = 'Original paragraph';
    props.submissionField.defaultValue = 'Original paragraph';
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      Promise.resolve(
        createPreviewResponse(
          request,
          '<p>Original paragraph</p>' as SafePreviewHtml,
          {}
        )
      )
    );
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
    fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
    const visualEditor = await view.findByRole('textbox', {
      name: '可视化文章编辑器'
    });
    const prepare = props.wechatClipboard.prepare;
    if (!prepare) throw new Error('wechat preparation is unavailable');
    const preparation = vi.mocked(prepare);
    preparation.mockClear();

    visualEditor.innerHTML = '<p>Rendered visual edit</p>';
    fireEvent.input(visualEditor);

    expect(preparation).not.toHaveBeenCalled();
    view.unmount();
  });

  it('cancels a queued WeChat layout preparation when visual editing starts', async () => {
    const baseProps = fixture();
    const markdown = Array.from(
      { length: 200 },
      (_, index) => `Paragraph ${index}`
    ).join('\n');
    const html = Array.from(
      { length: 200 },
      (_, index) => `<p>Paragraph ${index}</p>`
    ).join('') as SafePreviewHtml;
    const scheduled: Array<{ active: boolean; callback: () => void }> = [];
    const props = {
      ...baseProps,
      immersiveEnvironment: {
        ...baseProps.immersiveEnvironment,
        schedule: (callback: () => void) => {
          const task = { active: true, callback };
          scheduled.push(task);
          return () => {
            task.active = false;
          };
        }
      }
    };
    props.submissionField.value = markdown;
    props.submissionField.defaultValue = markdown;
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      Promise.resolve(createPreviewResponse(request, html, {}))
    );
    const view = render(<EditorRoot {...props} />);
    const prepare = props.wechatClipboard.prepare;
    if (!prepare) throw new Error('wechat preparation is unavailable');
    const preparation = vi.mocked(prepare);

    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull(), {
      timeout: 5_000
    });

    preparation.mockClear();
    scheduled.length = 0;
    act(() => props.triggerPreviewLayout());
    fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
    act(() => {
      scheduled
        .filter(({ active }) => active)
        .forEach(({ callback }) => {
          callback();
        });
    });
    expect(preparation).not.toHaveBeenCalled();
    view.unmount();
  });

  it('cancels an active WeChat background preparation when visual editing starts', async () => {
    const baseProps = fixture();
    const pendingPreparation = deferred<void>();
    const scheduled: Array<{ active: boolean; callback: () => void }> = [];
    let activeSignal: AbortSignal | null = null;
    const prepare = vi.fn(
      (
        _surface: HTMLElement,
        options?: { background?: boolean; signal?: AbortSignal }
      ) => {
        if (options?.background) {
          activeSignal = options.signal ?? null;
          return pendingPreparation.promise;
        }
        return Promise.resolve();
      }
    );
    const props = {
      ...baseProps,
      immersiveEnvironment: {
        ...baseProps.immersiveEnvironment,
        schedule: (callback: () => void) => {
          const task = { active: true, callback };
          scheduled.push(task);
          return () => {
            task.active = false;
          };
        }
      },
      wechatClipboard: {
        ...baseProps.wechatClipboard,
        prepare
      }
    };
    const view = render(<EditorRoot {...props} />);

    try {
      fireEvent.click(
        await view.findByRole('button', { name: '进入沉浸写作' })
      );
      fireEvent.click(view.getByRole('button', { name: '预览' }));
      await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull(), {
        timeout: 5_000
      });

      scheduled.length = 0;
      act(() => props.triggerPreviewLayout());
      const task = scheduled.find(({ active }) => active);
      if (!task) throw new Error('missing WeChat background preparation task');
      act(() => task.callback());
      await waitFor(() => expect(prepare).toHaveBeenCalledOnce());
      expect(prepare.mock.calls[0]?.[1]).toMatchObject({ background: true });

      fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
      await view.findByRole('textbox', { name: '可视化文章编辑器' });

      expect(activeSignal).not.toBeNull();
      expect((activeSignal as AbortSignal | null)?.aborted).toBe(true);
    } finally {
      pendingPreparation.resolve();
      view.unmount();
    }
  });

  it('does not schedule WeChat preparation during rapid immersive visual edits', async () => {
    const props = fixture();
    props.submissionField.value = 'Original paragraph';
    props.submissionField.defaultValue = 'Original paragraph';
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      Promise.resolve(
        createPreviewResponse(
          request,
          '<p>Original paragraph</p>' as SafePreviewHtml,
          {}
        )
      )
    );
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
    fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
    const visualEditor = await view.findByRole('textbox', {
      name: '可视化文章编辑器'
    });
    const prepare = props.wechatClipboard.prepare;
    if (!prepare) throw new Error('wechat preparation is unavailable');
    const preparation = vi.mocked(prepare);
    const preparationCallsBeforeEdit = preparation.mock.calls.length;

    vi.useFakeTimers();
    try {
      visualEditor.innerHTML = '<p>Rapid edit 1</p>';
      fireEvent.input(visualEditor);
      act(() => vi.advanceTimersByTime(100));
      visualEditor.innerHTML = '<p>Rapid edit 2</p>';
      fireEvent.input(visualEditor);
      act(() => vi.advanceTimersByTime(100));
      visualEditor.innerHTML = '<p>Rapid edit 3</p>';
      fireEvent.input(visualEditor);

      expect(preparation.mock.calls.length).toBe(preparationCallsBeforeEdit);
      act(() => vi.advanceTimersByTime(259));
      expect(preparation.mock.calls.length).toBe(preparationCallsBeforeEdit);
      act(() => vi.advanceTimersByTime(1));
      expect(preparation.mock.calls.length).toBe(preparationCallsBeforeEdit);
    } finally {
      vi.useRealTimers();
    }
  });

  it('restores generated blocks when a visual selection deletes a read-only region', async () => {
    const source = [
      'Editable paragraph',
      '',
      '$$',
      'x^2',
      '$$',
      '',
      '```mermaid',
      'flowchart TD',
      'A-->B',
      '```'
    ].join('\n');
    const props = fixture();
    props.submissionField.value = source;
    props.submissionField.defaultValue = source;
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      Promise.resolve(
        createPreviewResponse(
          request,
          [
            '<p>Editable paragraph</p>',
            '<div class="easymde-math easymde-math-block">$$x^2$$</div>',
            '<pre><code class="language-mermaid">flowchart TD\nA--&gt;B</code></pre>'
          ].join('') as SafePreviewHtml,
          { math: true, mermaid: true }
        )
      )
    );
    vi.mocked(props.enhancementPort.enhance).mockImplementation(
      async (surface) => {
        const math = surface.querySelector<HTMLElement>('.easymde-math');
        if (math) {
          math.innerHTML = '<span class="katex">rendered math</span>';
          math.dataset.easymdeRendered = '1';
        }
        const mermaid = surface.querySelector(
          'pre:has(> code.language-mermaid)'
        );
        mermaid?.replaceWith(
          Object.assign(document.createElement('div'), {
            className: 'easymde-mermaid',
            innerHTML: '<svg><text>rendered diagram</text></svg>'
          })
        );
      }
    );
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
    fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
    const visualEditor = await view.findByRole('textbox', {
      name: '可视化文章编辑器'
    });
    visualEditor.querySelector('.easymde-mermaid')?.remove();
    fireEvent.input(visualEditor);

    await waitFor(() => {
      expect(props.submissionField.value).toBe(source);
      expect(visualEditor.querySelector('.easymde-mermaid svg')).not.toBeNull();
      expect(props.onFailure).toHaveBeenCalledWith(
        'visual-editor-read-only-region-mutated'
      );
    });
  });

  it('keeps an unchanged visual Preview lock transition independent of selection mapping', async () => {
    const props = fixture();
    props.submissionField.value = 'Before **selected** after';
    props.submissionField.defaultValue = 'Before **selected** after';
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      Promise.resolve(
        createPreviewResponse(
          request,
          '<p>Before <strong>selected</strong> after</p>' as SafePreviewHtml,
          {}
        )
      )
    );
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
    fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
    const visualEditor = await view.findByRole('textbox', {
      name: '可视化文章编辑器'
    });
    const selectedText = visualEditor.querySelector('strong')?.firstChild;
    if (!selectedText) {
      throw new Error('missing synthetic visual mode selection target');
    }
    const source = view.container.querySelector<HTMLElement>('.cm-content');
    const editor = source ? EditorView.findFromDOM(source) : null;
    const selectionBeforeLock = editor?.state.selection.main;
    const range = document.createRange();
    range.selectNodeContents(selectedText);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    const lockPreview = view.getByRole('button', { name: '锁定为只读' });
    expect(fireEvent.mouseDown(lockPreview)).toBe(false);
    expect(window.getSelection()?.toString()).toBe('selected');
    fireEvent.click(lockPreview);

    expect(editor?.state.selection.main).toEqual(selectionBeforeLock);
    await waitFor(() =>
      expect(
        view.queryByRole('textbox', { name: '可视化文章编辑器' })
      ).toBeNull()
    );

    fireEvent.click(view.getByRole('button', { name: '编辑' }));

    expect(editor?.state.selection.main).toEqual(selectionBeforeLock);
  });

  it('keeps publish editing local until confirmation then delegates to the native publisher', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));

    fireEvent.click(view.getByRole('button', { name: '更新文章' }));
    expect(view.getByRole('dialog', { name: '更新文章' })).not.toBeNull();
    expect(
      (
        view.getByRole('switch', {
          name: '更新后打开文章页面'
        }) as HTMLInputElement
      ).checked
    ).toBe(true);
    expect(props.nativePublishPort.apply).not.toHaveBeenCalled();
    expect(props.publishPost).not.toHaveBeenCalled();

    const excerpt = view.getByPlaceholderText(
      '撰写摘要...'
    ) as HTMLTextAreaElement;
    fireEvent.change(excerpt, { target: { value: '尚未提交的摘要' } });
    const backdrop = view.container.querySelector('.easymde-publish-backdrop');
    if (!(backdrop instanceof HTMLElement)) {
      throw new Error('publish-backdrop-unavailable');
    }
    fireEvent.click(backdrop);
    expect(view.getByRole('dialog', { name: '更新文章' })).not.toBeNull();
    expect(excerpt.value).toBe('尚未提交的摘要');

    fireEvent.click(view.getByRole('button', { name: '取消' }));
    expect(view.queryByRole('dialog', { name: '更新文章' })).toBeNull();
    expect(props.nativePublishPort.apply).not.toHaveBeenCalled();

    fireEvent.click(view.getByRole('button', { name: '更新文章' }));
    fireEvent.click(view.getByRole('switch', { name: '更新后打开文章页面' }));
    fireEvent.click(
      within(view.getByRole('dialog', { name: '更新文章' })).getByRole(
        'button',
        {
          name: '更新文章'
        }
      )
    );

    expect(props.nativePublishPort.apply).toHaveBeenCalledOnce();
    expect(props.nativePublishPort.apply).toHaveBeenCalledWith(
      expect.objectContaining({ openPreview: false })
    );
    expect(props.publishPost).toHaveBeenCalledOnce();
    expect(props.executeExternalCommand).not.toHaveBeenCalledWith(
      'savepost',
      expect.anything()
    );
  });

  it('synchronizes pending visual input before deriving the publish excerpt', async () => {
    const props = fixture();
    const original = 'Original excerpt';
    const edited = 'Latest visual excerpt';
    props.submissionField.value = original;
    props.submissionField.defaultValue = original;
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      Promise.resolve(
        createPreviewResponse(
          request,
          `<p>${original}</p>` as SafePreviewHtml,
          {}
        )
      )
    );
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
    fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
    const visualEditor = await view.findByRole('textbox', {
      name: '可视化文章编辑器'
    });

    fireEvent.compositionStart(visualEditor);
    visualEditor.innerHTML = `<p>${edited}</p>`;
    fireEvent.input(visualEditor, { isComposing: true });
    expect(props.submissionField.value).toBe(original);

    fireEvent.click(view.getByRole('button', { name: '更新文章' }));

    const dialog = view.getByRole('dialog', { name: '更新文章' });
    expect(
      (
        within(dialog).getByPlaceholderText(
          '撰写摘要...'
        ) as HTMLTextAreaElement
      ).value
    ).toBe(edited);
    expect(props.submissionField.value).toBe(edited);
  });

  it('does not open publish when pending visual input cannot synchronize', async () => {
    const source = ['Editable paragraph', '', '$$', 'x^2', '$$'].join('\n');
    const props = fixture();
    props.submissionField.value = source;
    props.submissionField.defaultValue = source;
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      Promise.resolve(
        createPreviewResponse(
          request,
          [
            '<p>Editable paragraph</p>',
            '<div class="easymde-math easymde-math-block">$$x^2$$</div>'
          ].join('') as SafePreviewHtml,
          { math: true }
        )
      )
    );
    vi.mocked(props.enhancementPort.enhance).mockImplementation(
      async (surface) => {
        const math = surface.querySelector<HTMLElement>('.easymde-math');
        if (math) {
          math.innerHTML = '<span class="katex">rendered math</span>';
          math.dataset.easymdeRendered = '1';
        }
      }
    );
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
    fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
    const visualEditor = await view.findByRole('textbox', {
      name: '可视化文章编辑器'
    });
    visualEditor.querySelector('.easymde-math')?.remove();
    const publishSnapshotReads = vi.mocked(props.nativePublishPort.read).mock
      .calls.length;

    fireEvent.click(view.getByRole('button', { name: '更新文章' }));

    expect(view.queryByRole('dialog', { name: '更新文章' })).toBeNull();
    expect(props.nativePublishPort.read).toHaveBeenCalledTimes(
      publishSnapshotReads
    );
    expect(props.publishPost).not.toHaveBeenCalled();
    expect(props.onFailure).toHaveBeenCalledWith(
      'visual-editor-read-only-region-mutated'
    );
  });

  it.each([
    ['auto-55', 55],
    ['auto-100', 100]
  ] as const)(
    'derives the %s publish excerpt from the current Markdown without writing before confirmation',
    async (summaryMode, characterLimit) => {
      const props = fixture();
      const markdown = '摘😀'.repeat(60);
      const expected = Array.from(markdown).slice(0, characterLimit).join('');
      props.submissionField.value = markdown;
      props.submissionField.defaultValue = markdown;
      vi.mocked(props.nativePublishPort.read).mockReturnValue({
        ...props.nativePublishPort.read(),
        excerpt: 'WordPress 原生摘要'
      });
      const view = render(
        <EditorRoot
          {...props}
          settings={{
            general: { ...props.settings.general, summaryMode },
            markdown: props.settings.markdown
          }}
        />
      );

      fireEvent.click(
        await view.findByRole('button', { name: '进入沉浸写作' })
      );
      fireEvent.click(view.getByRole('button', { name: '更新文章' }));
      const dialog = view.getByRole('dialog', { name: '更新文章' });
      expect(
        (
          within(dialog).getByPlaceholderText(
            '撰写摘要...'
          ) as HTMLTextAreaElement
        ).value
      ).toBe(expected);
      expect(
        within(dialog).getByText(`${characterLimit} / 160`)
      ).not.toBeNull();
      expect(props.nativePublishPort.apply).not.toHaveBeenCalled();
      expect(props.publishPost).not.toHaveBeenCalled();

      fireEvent.click(within(dialog).getByRole('button', { name: '更新文章' }));
      expect(props.nativePublishPort.apply).toHaveBeenCalledWith(
        expect.objectContaining({ excerpt: expected })
      );
    }
  );

  it('keeps the native WordPress excerpt in manual mode and discards a cancelled dialog draft', async () => {
    const props = fixture();
    props.submissionField.value = '当前 Markdown 正文与原生摘要不同';
    props.submissionField.defaultValue = props.submissionField.value;
    vi.mocked(props.nativePublishPort.read).mockReturnValue({
      ...props.nativePublishPort.read(),
      excerpt: 'WordPress 原生摘要'
    });
    const view = render(
      <EditorRoot
        {...props}
        settings={{
          general: { ...props.settings.general, summaryMode: 'manual' },
          markdown: props.settings.markdown
        }}
      />
    );
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '更新文章' }));
    let dialog = view.getByRole('dialog', { name: '更新文章' });
    const firstDraft = within(dialog).getByPlaceholderText(
      '撰写摘要...'
    ) as HTMLTextAreaElement;

    expect(firstDraft.value).toBe('WordPress 原生摘要');
    fireEvent.change(firstDraft, { target: { value: '取消的手工摘要' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
    expect(props.nativePublishPort.apply).not.toHaveBeenCalled();
    expect(props.publishPost).not.toHaveBeenCalled();

    fireEvent.click(view.getByRole('button', { name: '更新文章' }));
    dialog = view.getByRole('dialog', { name: '更新文章' });
    const confirmedDraft = within(dialog).getByPlaceholderText(
      '撰写摘要...'
    ) as HTMLTextAreaElement;
    expect(confirmedDraft.value).toBe('WordPress 原生摘要');
    fireEvent.change(confirmedDraft, { target: { value: '确认的手工摘要' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '更新文章' }));

    expect(props.nativePublishPort.apply).toHaveBeenCalledOnce();
    expect(props.nativePublishPort.apply).toHaveBeenCalledWith(
      expect.objectContaining({ excerpt: '确认的手工摘要' })
    );
  });

  it('limits manual publish excerpts to 160 Unicode code points before submission', async () => {
    const props = fixture();
    const entered = '摘😀'.repeat(100);
    const expected = Array.from(entered).slice(0, 160).join('');
    const view = render(
      <EditorRoot
        {...props}
        settings={{
          general: { ...props.settings.general, summaryMode: 'manual' },
          markdown: props.settings.markdown
        }}
      />
    );

    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '更新文章' }));
    const dialog = view.getByRole('dialog', { name: '更新文章' });
    const excerpt = within(dialog).getByPlaceholderText(
      '撰写摘要...'
    ) as HTMLTextAreaElement;

    fireEvent.change(excerpt, { target: { value: entered } });
    expect(excerpt.value).toBe(expected);
    expect(Array.from(excerpt.value)).toHaveLength(160);
    expect(within(dialog).getByText('160 / 160')).not.toBeNull();

    fireEvent.click(within(dialog).getByRole('button', { name: '更新文章' }));
    expect(props.nativePublishPort.apply).toHaveBeenCalledWith(
      expect.objectContaining({ excerpt: expected })
    );
  });

  it('restores the legacy protected-post password field contract', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '更新文章' }));

    const dialog = view.getByRole('dialog', { name: '更新文章' });
    fireEvent.click(within(dialog).getByRole('radio', { name: '密码' }));

    const password = within(dialog).getByPlaceholderText(
      '输入访问密码'
    ) as HTMLInputElement;
    expect(password.type).toBe('password');
    expect(password.maxLength).toBe(255);

    fireEvent.click(within(dialog).getByRole('button', { name: '更新文章' }));
    expect(within(dialog).getByRole('alert').textContent).toBe(
      '请输入访问密码后再提交。'
    );
    expect(document.activeElement).toBe(password);
    expect(props.nativePublishPort.apply).not.toHaveBeenCalled();
    expect(props.publishPost).not.toHaveBeenCalled();

    fireEvent.change(password, { target: { value: 'temporary-password' } });
    fireEvent.click(within(dialog).getByRole('radio', { name: '私密' }));
    expect(within(dialog).queryByPlaceholderText('输入访问密码')).toBeNull();
    fireEvent.click(within(dialog).getByRole('radio', { name: '密码' }));
    expect(
      (within(dialog).getByPlaceholderText('输入访问密码') as HTMLInputElement)
        .value
    ).toBe('');
  });

  it('renders the source-accurate publish decorations and submitting progress owner', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '更新文章' }));

    const dialog = view.getByRole('dialog', { name: '更新文章' });
    expect(
      dialog.querySelectorAll('.easymde-publish-heading-sparkle')
    ).toHaveLength(1);
    expect(
      dialog.querySelectorAll('.easymde-publish-button-sparkles svg')
    ).toHaveLength(2);
    expect(
      dialog.querySelector('.easymde-publish-featured-placeholder')
    ).toBeNull();
    expect(
      within(dialog).getByRole('button', { name: /选择特色图片/u })
    ).not.toBeNull();
    expect(within(dialog).getByText('建议使用横向图片')).not.toBeNull();
    expect(
      within(dialog).getByText('支持 JPG、PNG、WebP 格式，最大 5MB')
    ).not.toBeNull();
    const progress = dialog.querySelector('.easymde-publish-progress');
    expect(progress?.getAttribute('aria-live')).toBe('polite');
    expect(progress?.textContent).toBe('');

    fireEvent.click(within(dialog).getByRole('button', { name: '更新文章' }));

    expect(progress?.textContent).toBe('加载预览中...');
    expect(dialog.getAttribute('aria-busy')).toBe('true');
  });

  it('renders the effective image-upload guidance supplied by WordPress', async () => {
    const props = fixture();
    const view = render(
      <EditorRoot
        {...props}
        immersiveStrings={{
          ...props.immersiveStrings,
          imageRequirements: '支持 JPG、PNG、WebP 格式，最大 3 MB'
        }}
      />
    );
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '更新文章' }));

    expect(
      within(view.getByRole('dialog', { name: '更新文章' })).getByText(
        '支持 JPG、PNG、WebP 格式，最大 3 MB'
      )
    ).not.toBeNull();
  });

  it('labels the existing WordPress Post action as update throughout immersive mode', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));

    expect(view.getByRole('button', { name: '更新文章' })).not.toBeNull();
    expect(view.queryByRole('button', { name: '发布文章' })).toBeNull();
  });

  it('labels a new WordPress Post action as publish throughout immersive mode', async () => {
    const props = fixture();
    vi.mocked(props.nativePublishPort.read).mockReturnValue({
      ...props.nativePublishPort.read(),
      categories: [
        {
          children: [],
          id: 'current-category',
          label: '当前分类'
        }
      ],
      categoryIds: ['current-category'],
      existing: false,
      openPreview: true
    });
    const view = render(
      <EditorRoot
        {...props}
        settings={{
          general: {
            ...props.settings.general,
            openPreviewAfterPublish: false,
            publishVisibility: 'private'
          },
          markdown: props.settings.markdown
        }}
      />
    );
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));

    fireEvent.click(view.getByRole('button', { name: '发布文章' }));
    const dialog = view.getByRole('dialog', { name: '发布文章' });
    expect(dialog).not.toBeNull();
    expect(view.queryByRole('button', { name: '更新文章' })).toBeNull();
    expect(
      (within(dialog).getByRole('radio', { name: '私密' }) as HTMLInputElement)
        .checked
    ).toBe(true);
    expect(
      (
        within(dialog).getByRole('switch', {
          name: '发布后打开文章页面'
        }) as HTMLInputElement
      ).checked
    ).toBe(false);
    expect(
      (
        within(dialog).getByRole('checkbox', {
          name: '当前分类'
        }) as HTMLInputElement
      ).checked
    ).toBe(true);
    expect(
      dialog.querySelector('.easymde-publish-featured-placeholder')
    ).toBeNull();

    fireEvent.click(within(dialog).getByRole('button', { name: '发布文章' }));
    expect(props.nativePublishPort.apply).toHaveBeenCalledWith(
      expect.objectContaining({ categoryIds: ['current-category'] })
    );
  });

  it('keeps hierarchical WordPress category selections independent', async () => {
    const props = fixture();
    vi.mocked(props.nativePublishPort.read).mockReturnValue({
      availableFields: {
        categories: true,
        excerpt: true,
        featuredImage: true,
        sticky: true,
        tags: true,
        visibility: true
      },
      categories: [
        {
          children: [
            {
              children: [],
              id: 'child',
              label: '子分类'
            }
          ],
          id: 'parent',
          label: '父分类'
        }
      ],
      categoryIds: ['child'],
      excerpt: '',
      featuredImage: null,
      openPreview: false,
      password: '',
      existing: true,
      sticky: false,
      tags: [],
      visibility: 'public'
    });
    const view = render(<EditorRoot {...props} />);
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '更新文章' }));

    const parent = view.getByRole('checkbox', {
      name: '父分类'
    }) as HTMLInputElement;
    const child = view.getByRole('checkbox', {
      name: '子分类'
    }) as HTMLInputElement;
    expect(parent.checked).toBe(false);
    expect(parent.indeterminate).toBe(true);
    expect(child.checked).toBe(true);

    fireEvent.click(view.getByRole('button', { name: '收起 父分类' }));
    expect(view.queryByRole('checkbox', { name: '子分类' })).toBeNull();
    fireEvent.click(view.getByRole('button', { name: '展开 父分类' }));
    fireEvent.click(view.getByRole('checkbox', { name: '子分类' }));
    fireEvent.click(
      within(view.getByRole('dialog', { name: '更新文章' })).getByRole(
        'button',
        {
          name: '更新文章'
        }
      )
    );

    expect(props.nativePublishPort.apply).toHaveBeenCalledWith(
      expect.objectContaining({ categoryIds: [] })
    );
  });

  it('omits publish controls without authoritative WordPress form owners', async () => {
    const props = fixture();
    vi.mocked(props.nativePublishPort.read).mockReturnValue({
      ...props.nativePublishPort.read(),
      availableFields: {
        categories: false,
        excerpt: false,
        featuredImage: false,
        sticky: false,
        tags: false,
        visibility: true
      }
    });
    const view = render(<EditorRoot {...props} />);
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '更新文章' }));

    const dialog = within(view.getByRole('dialog', { name: '更新文章' }));
    expect(dialog.queryByText('标签')).toBeNull();
    expect(dialog.queryByText('摘要')).toBeNull();
    expect(dialog.queryByText('分类')).toBeNull();
    expect(dialog.queryByText('封面图')).toBeNull();
    expect(dialog.queryByRole('checkbox', { name: '置于首页顶端' })).toBeNull();
    expect(dialog.getByRole('radiogroup', { name: '可见性' })).not.toBeNull();
  });

  it('restores the native publish fields when the WordPress submit command is unavailable', async () => {
    const props = fixture();
    vi.mocked(props.publishPost).mockReturnValue(false);
    const original = props.nativePublishPort.read();
    const view = render(<EditorRoot {...props} />);
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '更新文章' }));
    fireEvent.click(
      within(view.getByRole('dialog', { name: '更新文章' })).getByRole(
        'button',
        {
          name: '更新文章'
        }
      )
    );

    expect(props.nativePublishPort.apply).toHaveBeenCalledTimes(2);
    expect(props.nativePublishPort.apply).toHaveBeenLastCalledWith(original);
    expect(props.onFailure).toHaveBeenCalledWith(
      'immersive-publish-command-unavailable'
    );
    const dialog = view.getByRole('dialog', { name: '更新文章' });
    expect(within(dialog).getByRole('alert').textContent).toBe(
      'WordPress 未接受发布请求，请检查页面状态后重试。'
    );
    expect(
      view.container.querySelector('.easymde-editor-message-alert-host')
    ).toBeNull();
  });

  it('reports a native publish owner that disappears before confirmation', async () => {
    const props = fixture();
    vi.mocked(props.nativePublishPort.apply).mockImplementationOnce(() => {
      throw new Error('native-publish-tags-owner-unavailable');
    });
    const view = render(<EditorRoot {...props} />);
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '更新文章' }));
    fireEvent.click(
      within(view.getByRole('dialog', { name: '更新文章' })).getByRole(
        'button',
        {
          name: '更新文章'
        }
      )
    );

    expect(props.publishPost).not.toHaveBeenCalled();
    expect(props.onFailure).toHaveBeenCalledWith(
      'immersive-publish-native-owner-unavailable'
    );
    expect(
      within(view.getByRole('dialog', { name: '更新文章' })).getByRole('alert')
        .textContent
    ).toBe('WordPress 未接受发布请求，请检查页面状态后重试。');
  });

  it('uses the existing title and document owners for immersive edits and table insertion', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));

    fireEvent.change(view.getByRole('textbox', { name: '文章标题' }), {
      target: { value: '沉浸标题' }
    });
    expect(props.titleField?.value).toBe('沉浸标题');
    expect(view.getByText('未保存')).not.toBeNull();

    fireEvent.click(view.getByRole('button', { name: '表格' }));
    fireEvent.click(view.getByRole('button', { name: '2 × 2' }));
    expect(props.submissionField.value).toContain(
      '|  |  |\n| --- | --- |\n|  |  |'
    );
    expect(props.submissionField.value).not.toMatch(/[一-鿿]/u);
    expect(
      view.container.querySelectorAll('[data-easymde-document-owner="react"]')
    ).toHaveLength(1);
  });

  it('leaves visual Preview before a table mutates the Markdown owner', async () => {
    const props = fixture();
    props.submissionField.value = 'Choose **this** text';
    props.submissionField.defaultValue = 'Choose **this** text';
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      Promise.resolve(
        createPreviewResponse(
          request,
          '<p>Choose <strong>this</strong> text</p>' as SafePreviewHtml,
          {}
        )
      )
    );
    const view = render(<EditorRoot {...props} />);
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
    fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
    const visualEditor = await view.findByRole('textbox', {
      name: '可视化文章编辑器'
    });
    const selectedText = visualEditor.querySelector('p')?.lastChild;
    if (!selectedText || Node.TEXT_NODE !== selectedText.nodeType) {
      throw new Error('missing synthetic visual table selection target');
    }
    const range = document.createRange();
    range.setStart(selectedText, selectedText.textContent?.length ?? 0);
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    fireEvent.click(view.getByRole('button', { name: '表格' }));
    expect(
      view.queryByRole('textbox', { name: '可视化文章编辑器' })
    ).toBeNull();
    fireEvent.click(view.getByRole('button', { name: '2 × 2' }));

    expect(props.submissionField.value).toBe(
      'Choose **this** text\n|  |  |\n| --- | --- |\n|  |  |\n'
    );
  });

  it('loads WordPress revisions, confirms dirty restoration and reports through the native handoff', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.change(view.getByRole('textbox', { name: '文章标题' }), {
      target: { value: 'Changed title' }
    });

    fireEvent.click(view.getByRole('button', { name: '历史记录' }));
    await waitFor(() =>
      expect(props.revisionPort?.list).toHaveBeenCalledOnce()
    );
    await waitFor(() =>
      expect(props.revisionPort?.get).toHaveBeenCalledWith(
        12,
        expect.any(AbortSignal)
      )
    );
    expect(view.getByText('共 1 条历史版本')).not.toBeNull();
    fireEvent.click(view.getByRole('button', { name: '恢复到这个版本' }));
    expect(props.restoreRevision).not.toHaveBeenCalled();
    expect(view.getByRole('alert').textContent).toContain(
      '未保存的更改将会丢失'
    );
    fireEvent.click(view.getByRole('button', { name: '恢复到这个版本' }));
    expect(props.restoreRevision).toHaveBeenCalledWith(
      'https://example.test/wp-admin/revision.php?revision=12'
    );
  });

  it('flushes a pending visual edit before History can restore a revision', async () => {
    const props = fixture();
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      Promise.resolve(
        createPreviewResponse(request, '<p>selected</p>' as SafePreviewHtml, {})
      )
    );
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
    fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
    const visualEditor = await view.findByRole('textbox', {
      name: '可视化文章编辑器'
    });

    vi.useFakeTimers();
    try {
      visualEditor.innerHTML = '<p>Immediate visual history edit</p>';
      fireEvent.input(visualEditor);
      expect(props.submissionField.value).toBe('selected');

      fireEvent.click(view.getByRole('button', { name: '历史记录' }));

      expect(props.submissionField.value).toBe('Immediate visual history edit');
      expect(
        view.queryByRole('textbox', { name: '可视化文章编辑器' })
      ).toBeNull();
    } finally {
      vi.useRealTimers();
    }

    await waitFor(() =>
      expect(props.revisionPort?.get).toHaveBeenCalledWith(
        12,
        expect.any(AbortSignal)
      )
    );
    fireEvent.click(view.getByRole('button', { name: '恢复到这个版本' }));

    expect(props.restoreRevision).not.toHaveBeenCalled();
    expect(view.getByRole('alert').textContent).toContain(
      '未保存的更改将会丢失'
    );
  });

  it('keeps History closed when a visual edit cannot synchronize safely', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
    fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
    const visualEditor = await view.findByRole('textbox', {
      name: '可视化文章编辑器'
    });

    visualEditor.innerHTML = '<p>Unmapped replacement</p>';
    fireEvent.click(view.getByRole('button', { name: '历史记录' }));

    expect(view.queryByRole('dialog', { name: '历史版本' })).toBeNull();
    expect(view.getByRole('textbox', { name: '可视化文章编辑器' })).toBe(
      visualEditor
    );
    expect(props.onFailure).toHaveBeenCalledWith(
      'visual-editor-markdown-merge-failed'
    );
  });

  it('keeps the History filter inside the modal focus loop while revisions load', async () => {
    const props = fixture();
    const revisionPort = {
      get: vi.fn(),
      list: vi.fn(() => new Promise<never>(() => undefined))
    };
    const view = render(<EditorRoot {...props} revisionPort={revisionPort} />);
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '历史记录' }));
    const dialog = view.getByRole('dialog', { name: '历史版本' });
    const filter = within(dialog).getByRole('combobox', { name: '全部' });
    const close = within(dialog).getByRole('button', { name: '取消' });
    filter.focus();

    expect(fireEvent.keyDown(filter, { key: 'Tab' })).toBe(false);
    expect(document.activeElement).toBe(close);
  });

  it('selects the first matching revision when History is filtered before loading completes', async () => {
    const revisions = deferred<ReadonlyArray<RevisionSummary>>();
    const props = fixture();
    const revisionPort = {
      get: vi.fn().mockResolvedValue({
        features: {},
        html: '<p>Automatic revision</p>' as SafePreviewHtml,
        id: 13
      }),
      list: vi.fn(() => revisions.promise)
    };
    const view = render(<EditorRoot {...props} revisionPort={revisionPort} />);
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '历史记录' }));
    fireEvent.change(view.getByRole('combobox', { name: '全部' }), {
      target: { value: 'auto' }
    });

    await act(async () => {
      revisions.resolve([
        {
          date: '2026-07-23T10:00:00Z',
          dateLabel: '10:00',
          id: 12,
          restoreUrl: 'https://example.test/wp-admin/revision.php?revision=12',
          title: 'Manual revision',
          type: 'manual'
        },
        {
          date: '2026-07-23T11:00:00Z',
          dateLabel: '11:00',
          id: 13,
          restoreUrl: 'https://example.test/wp-admin/revision.php?revision=13',
          title: 'Automatic revision',
          type: 'auto'
        }
      ]);
    });

    await waitFor(() =>
      expect(revisionPort.get).toHaveBeenCalledWith(13, expect.any(AbortSignal))
    );
    expect(view.getByText('Automatic revision')).not.toBeNull();
    expect(
      (
        view.getByRole('button', {
          name: '恢复到这个版本'
        }) as HTMLButtonElement
      ).disabled
    ).toBe(false);
  });

  it('ignores a stale revision preview that resolves after the current selection', async () => {
    const firstPreview = deferred<RevisionPreview>();
    const secondPreview = deferred<RevisionPreview>();
    const props = fixture();
    const revisionPort = {
      get: vi.fn((id: number) =>
        12 === id ? firstPreview.promise : secondPreview.promise
      ),
      list: vi.fn().mockResolvedValue([
        {
          date: '2026-07-23T10:00:00Z',
          dateLabel: '10:00',
          id: 12,
          restoreUrl: 'https://example.test/wp-admin/revision.php?revision=12',
          title: 'First',
          type: 'manual'
        },
        {
          date: '2026-07-23T11:00:00Z',
          dateLabel: '11:00',
          id: 13,
          restoreUrl: 'https://example.test/wp-admin/revision.php?revision=13',
          title: 'Second',
          type: 'manual'
        }
      ])
    };
    const view = render(<EditorRoot {...props} revisionPort={revisionPort} />);
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '历史记录' }));

    await waitFor(() =>
      expect(revisionPort.get).toHaveBeenCalledWith(12, expect.any(AbortSignal))
    );
    fireEvent.click(view.getByRole('button', { name: '手动保存11:00' }));
    await waitFor(() =>
      expect(revisionPort.get).toHaveBeenCalledWith(13, expect.any(AbortSignal))
    );

    await act(async () => {
      secondPreview.resolve({
        features: {},
        html: '<p>Current revision</p>' as SafePreviewHtml,
        id: 13
      });
    });
    expect(view.getByText('Current revision')).not.toBeNull();

    await act(async () => {
      firstPreview.resolve({
        features: {},
        html: '<p>Stale revision</p>' as SafePreviewHtml,
        id: 12
      });
    });
    expect(view.getByText('Current revision')).not.toBeNull();
    expect(view.queryByText('Stale revision')).toBeNull();
  });

  it('moves History selection into the active filter and aborts the hidden preview', async () => {
    const props = fixture();
    const revisionPort = {
      get: vi.fn().mockImplementation(
        (id: number) =>
          new Promise<RevisionPreview>((resolve) => {
            if (13 === id) {
              resolve({
                features: {},
                html: '<p>Automatic revision</p>' as SafePreviewHtml,
                id: 13
              });
            }
          })
      ),
      list: vi.fn().mockResolvedValue([
        {
          date: '2026-07-23T10:00:00Z',
          dateLabel: '10:00',
          id: 12,
          restoreUrl: 'https://example.test/wp-admin/revision.php?revision=12',
          title: 'Manual revision',
          type: 'manual' as const
        },
        {
          date: '2026-07-23T11:00:00Z',
          dateLabel: '11:00',
          id: 13,
          restoreUrl: 'https://example.test/wp-admin/revision.php?revision=13',
          title: 'Automatic revision',
          type: 'auto' as const
        }
      ])
    };
    const view = render(<EditorRoot {...props} revisionPort={revisionPort} />);
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '历史记录' }));

    await waitFor(() =>
      expect(revisionPort.get).toHaveBeenCalledWith(12, expect.any(AbortSignal))
    );
    const manualSignal = revisionPort.get.mock.calls[0]?.[1] as AbortSignal;
    fireEvent.change(view.getByRole('combobox', { name: '全部' }), {
      target: { value: 'auto' }
    });

    await waitFor(() =>
      expect(revisionPort.get).toHaveBeenCalledWith(13, expect.any(AbortSignal))
    );
    expect(manualSignal.aborted).toBe(true);
    expect(view.queryByRole('button', { name: '手动保存10:00' })).toBeNull();
    fireEvent.click(view.getByRole('button', { name: '恢复到这个版本' }));
    expect(props.restoreRevision).toHaveBeenCalledWith(
      'https://example.test/wp-admin/revision.php?revision=13'
    );
  });

  it('layers Escape handling and restores focus to the immersive entry after exit', async () => {
    const props = fixture();
    const restoreFavicon = vi.fn();
    vi.mocked(props.immersiveEnvironment.activateFavicon).mockReturnValue(
      restoreFavicon
    );
    const view = render(<EditorRoot {...props} />);
    const entry = await view.findByRole('button', { name: '进入沉浸写作' });
    entry.focus();
    fireEvent.click(entry);
    expect(props.immersiveEnvironment.activateFavicon).toHaveBeenCalledOnce();
    expect(
      props.immersiveEnvironment.activateFocusBoundary
    ).toHaveBeenCalledWith(view.container.querySelector('.easymde-editor'));
    expect(document.activeElement).toBe(
      view.container.querySelector('.cm-content')
    );
    fireEvent.click(view.getByRole('button', { name: '表格' }));

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(view.queryByRole('dialog', { name: '表格' })).toBeNull();
    expect(view.getByRole('region', { name: '沉浸写作' })).not.toBeNull();

    fireEvent.click(view.getByRole('button', { name: '编辑器设置' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(view.queryByRole('dialog', { name: '编辑器设置' })).toBeNull();
    expect(view.getByRole('region', { name: '沉浸写作' })).not.toBeNull();
    expect(document.activeElement).toBe(
      view.getByRole('button', { name: '编辑器设置' })
    );

    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() =>
      expect(document.activeElement).toBe(
        view.getByRole('button', { name: '进入沉浸写作' })
      )
    );
    expect(view.queryByRole('region', { name: '沉浸写作' })).toBeNull();
    expect(restoreFavicon).toHaveBeenCalledOnce();
  });

  it('matches the reference immersive control inventory without AI controls', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));

    expect(view.getByRole('button', { name: '编辑模式' })).not.toBeNull();
    expect(view.getByRole('button', { name: '分屏模式' })).not.toBeNull();
    expect(view.getByRole('button', { name: '预览模式' })).not.toBeNull();
    expect(view.getAllByRole('button', { name: '退出沉浸写作' })).toHaveLength(
      1
    );
    expect(
      view.container.querySelectorAll(
        '.easymde-immersive-formatting .easymde-toolbar-divider'
      )
    ).toHaveLength(1);
    expect(
      view.container.querySelector(
        '.easymde-immersive-header .easymde-immersive-exit'
      )
    ).toBeNull();
    expect(view.queryByRole('button', { name: /AI/u })).toBeNull();
    expect(view.getByRole('button', { name: '编辑器设置' })).not.toBeNull();
    expect(view.queryByRole('button', { name: '更多操作' })).toBeNull();
    const moreActions = view.container.querySelector(
      '.easymde-immersive-more-actions'
    );
    expect(moreActions?.tagName).toBe('SPAN');
    expect(moreActions?.getAttribute('aria-hidden')).toBe('true');
    const settings = view.getByRole('button', { name: '编辑器设置' });
    settings.focus();
    fireEvent.click(moreActions as HTMLElement);
    expect(document.activeElement).toBe(settings);

    const tableIcon = view
      .getByRole('button', { name: '表格' })
      .querySelector('svg');
    expect(
      Array.from(tableIcon?.children ?? []).map((node) => ({
        d: node.getAttribute('d'),
        height: node.getAttribute('height'),
        tag: node.tagName.toLowerCase(),
        width: node.getAttribute('width'),
        x: node.getAttribute('x'),
        y: node.getAttribute('y')
      }))
    ).toEqual([
      {
        d: 'M12 3v18',
        height: null,
        tag: 'path',
        width: null,
        x: null,
        y: null
      },
      { d: null, height: '18', tag: 'rect', width: '18', x: '3', y: '3' },
      {
        d: 'M3 9h18',
        height: null,
        tag: 'path',
        width: null,
        x: null,
        y: null
      },
      {
        d: 'M3 15h18',
        height: null,
        tag: 'path',
        width: null,
        x: null,
        y: null
      }
    ]);

    expect(
      Array.from(
        view.container.querySelectorAll('.easymde-immersive-wechat-glyph path')
      ).map((path) => path.getAttribute('d'))
    ).toEqual([
      'M38.7,15.3c-3.7-4.9-10.2-6.2-16.1-4.1c0.2,0.1,0.4,0.1,0.6,0.2c8.7,2.9,13.3,12.3,10.4,21 c-0.8,2.3-2,4.3-3.5,6c1.9-0.5,3.8-1.3,5.4-2.5C42.1,30.8,43.4,21.4,38.7,15.3z',
      'M17,10.4L17,10.4C17,10.4,17,10.4,17,10.4c0.4-0.3,0.7-0.5,1.1-0.8c0,0,0,0,0.1,0c0.4-0.2,0.8-0.4,1.1-0.7 c0,0,0.1,0,0.1-0.1c0.8-0.4,1.6-0.7,2.4-1c0.1,0,0.1,0,0.2-0.1c0.4-0.1,0.8-0.3,1.2-0.4c0,0,0.1,0,0.1,0c0.4-0.1,0.8-0.2,1.2-0.2 c0.1,0,0.1,0,0.2,0C25.3,7,25.7,7,26.1,7c0.1,0,0.2,0,0.3,0c0.4,0,0.9-0.1,1.3-0.1c0.5,0,1,0,1.5,0.1c0.1,0,0.1,0,0.2,0 c0.5,0,0.9,0.1,1.4,0.2c0.1,0,0.2,0,0.2,0c0.5,0.1,0.9,0.2,1.3,0.3c0.1,0,0.1,0,0.2,0.1C33,7.7,33.5,7.8,33.9,8 c-0.2-0.4-0.4-0.7-0.4-0.7C30.6,2.7,25.8,0,20.6,0c-3.1,0-7.9,1.1-11.5,5.4c-2.4,2.9-3.2,6.3-2.7,9.7c0.3,2.3,1.6,5.4,3.5,7.3 C10.6,17.5,13.2,13.2,17,10.4z',
      'M20.6,30.9c-1.3,0-2.6-0.2-3.8-0.4c-0.1,0-0.3,0-0.5,0c-0.4,0-0.7,0.1-1,0.3l-4,2.6 c-0.1,0.1-0.2,0.1-0.4,0.1c-0.3,0-0.6-0.3-0.7-0.6c0-0.2,0-0.3,0.1-0.5c0-0.1,0.4-2,0.7-3.2c0-0.1,0.1-0.3,0-0.4 c0-0.4-0.2-0.8-0.6-1c-4.3-2.9-7.2-7.5-7.8-12.2c-1.1,1.7-1.6,3-2.2,5c-2.1,7.3,2.5,16,9.9,18.4c8.6,2.8,16.7-0.3,19.5-7.6 c0.3-0.9,0.7-2.4,0.8-3.6C27.7,29.9,24.6,30.9,20.6,30.9z'
    ]);

    fireEvent.click(view.getByRole('button', { name: '复制到公众号' }));
    await waitFor(() =>
      expect(view.getByRole('button', { name: '已复制' })).not.toBeNull()
    );
    expect(view.getByRole('status').textContent).toContain('Copied');
    expect(
      view.container.querySelector('.easymde-editor-message-alert-host')
    ).not.toBeNull();
    fireEvent.click(view.getByRole('button', { name: '编辑器设置' }));
    expect(view.getByRole('dialog', { name: '编辑器设置' })).not.toBeNull();
    for (const name of ['文章大纲', '分屏预览']) {
      expect(
        view.getByRole('checkbox', { name }).getAttribute('aria-checked')
      ).toBe('true');
    }
    expect(view.queryByRole('checkbox', { name: '自动保存' })).toBeNull();
    expect(view.queryByText(/AI/u)).toBeNull();
  });

  it('keeps the immersive H trigger stable while updating cursor status', async () => {
    const props = fixture();
    props.submissionField.value = '# First\nBody';
    props.submissionField.defaultValue = '# First\nBody';
    props.submissionField.setSelectionRange(0, 0);
    const toolbar = {
      ...props.toolbar,
      commands: [
        ...props.toolbar.commands,
        {
          action: 'heading',
          group: 'heading',
          icon: 'heading',
          id: 'heading1',
          label: 'Heading 1',
          level: 1,
          surface: 'heading-menu'
        }
      ]
    } as const;
    const view = render(<EditorRoot {...props} toolbar={toolbar} />);
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));

    const heading = view.getByRole('button', { name: 'Headings' });
    expect(
      heading.querySelector('.easymde-toolbar-text-icon')?.textContent
    ).toBe('H');
    expect(view.getByText('行 1, 列 1')).not.toBeNull();

    const input = view.container.querySelector<HTMLElement>('.cm-content');
    const editor = input ? EditorView.findFromDOM(input) : null;
    act(() => {
      editor?.dispatch({ selection: EditorSelection.cursor(8) });
    });

    await waitFor(() => {
      expect(
        heading.querySelector('.easymde-toolbar-text-icon')?.textContent
      ).toBe('H');
      expect(view.getByText('行 2, 列 1')).not.toBeNull();
    });
  });

  it('keeps unified operation feedback stable while leaving immersive mode', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));

    fireEvent.click(view.getByRole('button', { name: '复制到公众号' }));
    await waitFor(() =>
      expect(view.getByRole('button', { name: '已复制' })).not.toBeNull()
    );
    fireEvent.click(view.getByRole('button', { name: '退出沉浸写作' }));

    expect(view.getByRole('status').textContent).toContain('Copied');
    expect(
      view.container.querySelector('.easymde-editor-message-alert-host')
    ).not.toBeNull();
  });

  it('keeps a late immersive clipboard failure visible after returning to the ordinary editor', async () => {
    const props = fixture();
    type ClipboardResult = Awaited<
      ReturnType<typeof props.wechatClipboard.copy>
    >;
    let finishCopy: ((result: ClipboardResult) => void) | null = null;
    vi.mocked(props.wechatClipboard.copy).mockImplementation(
      () =>
        new Promise<ClipboardResult>((resolve) => {
          finishCopy = resolve;
        })
    );
    const view = render(<EditorRoot {...props} />);
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));

    fireEvent.click(view.getByRole('button', { name: '复制到公众号' }));
    fireEvent.click(view.getByRole('button', { name: '退出沉浸写作' }));
    await act(async () => {
      finishCopy?.({ code: 'wechat-copy-failed', status: 'failed' });
    });

    expect(view.getByText('Copy failed')).not.toBeNull();
    expect(
      view.container.querySelector('.easymde-editor-message-alert-host')
    ).not.toBeNull();
  });

  it('renders immersive operation failures in the shared top alert', async () => {
    const props = fixture();
    vi.mocked(props.wechatClipboard.copy).mockResolvedValue({
      code: 'wechat-copy-failed',
      status: 'failed'
    });
    const view = render(<EditorRoot {...props} />);
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));

    fireEvent.click(view.getByRole('button', { name: '复制到公众号' }));
    await waitFor(() =>
      expect(view.getByRole('alert').textContent).toBe('Copy failed')
    );
    expect(
      view.container.querySelector('.easymde-editor-message-alert-host')
    ).not.toBeNull();

    fireEvent.click(view.getByRole('button', { name: '退出沉浸写作' }));
    expect(view.getByRole('alert').textContent).toBe('Copy failed');
  });

  it('expires ordinary feedback after 3000ms without letting a stale timer clear newer feedback', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);
    await view.findByRole('button', { name: 'Copy to WeChat' });

    vi.useFakeTimers();
    try {
      await act(async () => {
        fireEvent.click(view.getByRole('button', { name: 'Copy to WeChat' }));
        await Promise.resolve();
      });
      expect(view.getByText('Copied')).not.toBeNull();

      act(() => {
        vi.advanceTimersByTime(2999);
      });
      expect(view.getByText('Copied')).not.toBeNull();

      await act(async () => {
        fireEvent.click(view.getByRole('button', { name: 'Copy to WeChat' }));
        await Promise.resolve();
      });
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(view.getByText('Copied')).not.toBeNull();

      act(() => {
        vi.advanceTimersByTime(2999);
      });
      expect(view.queryByText('Copied')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not let a stale close action clear newer feedback queued in the same turn', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);
    const copy = await view.findByRole('button', { name: 'Copy to WeChat' });

    fireEvent.click(copy);
    await waitFor(() => expect(view.getByText('Copied')).not.toBeNull());
    const staleClose = view.getByRole('button', { name: '关闭' });
    const source = view.container.querySelector('.cm-content');
    expect(source).not.toBeNull();

    act(() => {
      source?.dispatchEvent(
        imageTransferEvent(
          'paste',
          new File(['x'.repeat(1025)], 'too-large.png', { type: 'image/png' })
        )
      );
      staleClose.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(view.getByRole('alert').textContent).toBe('Paste too large');
  });

  it('resumes replacement feedback expiry after a focused stale close restores focus', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);
    const copy = await view.findByRole('button', { name: 'Copy to WeChat' });

    vi.useFakeTimers();
    try {
      await act(async () => {
        fireEvent.click(copy);
        await Promise.resolve();
      });
      const staleClose = view.getByRole('button', { name: '关闭' });
      const source = view.container.querySelector('.cm-content');
      expect(source).not.toBeNull();
      copy.focus();
      staleClose.focus();

      act(() => {
        source?.dispatchEvent(
          imageTransferEvent(
            'paste',
            new File(['x'.repeat(1025)], 'too-large.png', {
              type: 'image/png'
            })
          )
        );
        staleClose.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      expect(view.getByRole('alert').textContent).toBe('Paste too large');
      expect(document.activeElement).toBe(copy);
      act(() => {
        vi.advanceTimersByTime(3000);
      });
      expect(view.queryByRole('alert')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('resumes auto-dismiss with only the remaining time after focus leaves', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);
    await view.findByRole('button', { name: 'Copy to WeChat' });

    vi.useFakeTimers();
    try {
      await act(async () => {
        fireEvent.click(view.getByRole('button', { name: 'Copy to WeChat' }));
        await Promise.resolve();
      });
      const close = view.getByRole('button', { name: '关闭' });

      act(() => {
        vi.advanceTimersByTime(2500);
      });
      fireEvent.focus(close);

      act(() => {
        vi.advanceTimersByTime(6000);
      });
      expect(view.getByText('Copied')).not.toBeNull();

      fireEvent.blur(close);
      act(() => {
        vi.advanceTimersByTime(499);
      });
      expect(view.getByText('Copied')).not.toBeNull();

      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(view.queryByText('Copied')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('automatically dismisses an error after 3000ms', async () => {
    const props = fixture();
    vi.mocked(props.wechatClipboard.copy).mockResolvedValue({
      code: 'wechat-copy-failed',
      status: 'failed'
    });
    const view = render(<EditorRoot {...props} />);
    const copy = await view.findByRole('button', { name: 'Copy to WeChat' });

    vi.useFakeTimers();
    try {
      await act(async () => {
        fireEvent.click(copy);
        await Promise.resolve();
      });
      expect(view.getByRole('alert').textContent).toBe('Copy failed');

      act(() => {
        vi.advanceTimersByTime(2999);
      });
      expect(view.getByRole('alert').textContent).toBe('Copy failed');

      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(view.queryByRole('alert')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not let unrelated success feedback overwrite an error before auto-dismiss', async () => {
    const props = fixture();
    vi.mocked(props.wechatClipboard.copy).mockResolvedValue({
      code: 'wechat-copy-failed',
      status: 'failed'
    });
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(
      await view.findByRole('button', { name: 'Copy to WeChat' })
    );
    await waitFor(() =>
      expect(view.getByRole('alert').textContent).toBe('Copy failed')
    );

    fireEvent.click(view.getByRole('button', { name: 'Bold' }));
    await waitFor(() =>
      expect(props.localDraftStorage.write).toHaveBeenCalledOnce()
    );
    expect(view.getByRole('alert').textContent).toBe('Copy failed');
  });

  it('matches the reference 1800ms immersive copy-feedback duration', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));

    vi.useFakeTimers();
    try {
      await act(async () => {
        fireEvent.click(view.getByRole('button', { name: '复制到公众号' }));
        await Promise.resolve();
      });
      expect(view.getByRole('button', { name: '已复制' })).not.toBeNull();

      act(() => {
        vi.advanceTimersByTime(1799);
      });
      expect(view.getByRole('button', { name: '已复制' })).not.toBeNull();

      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(view.getByRole('button', { name: '复制到公众号' })).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('matches the reference outline drag bounds, reset and cleanup lifecycle', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    const separator = view.getByRole('separator', {
      name: '调整大纲宽度'
    });
    const outlineActions = view.getAllByRole('button', {
      name: '收起大纲'
    });
    const footerAction = outlineActions.at(-1);
    if (!footerAction) throw new Error('outline-footer-control-unavailable');
    expect(
      Array.from(footerAction.childNodes).some(
        (node) =>
          Node.TEXT_NODE === node.nodeType
          && '收起大纲' === node.textContent?.trim()
      )
    ).toBe(true);

    expect(separator.getAttribute('aria-valuenow')).toBe('240');
    fireEvent.pointerDown(separator, {
      clientX: 240,
      pointerId: 1,
      pointerType: 'touch'
    });
    expect(document.body.style.cursor).toBe('col-resize');
    expect(document.body.style.userSelect).toBe('none');
    fireEvent.pointerMove(document, { clientX: 500, pointerId: 1 });
    expect(separator.getAttribute('aria-valuenow')).toBe('360');
    fireEvent.pointerMove(document, { clientX: -100, pointerId: 1 });
    expect(separator.getAttribute('aria-valuenow')).toBe('190');
    fireEvent.pointerUp(document, { pointerId: 1 });
    expect(document.body.style.cursor).toBe('');
    expect(document.body.style.userSelect).toBe('');

    fireEvent.doubleClick(separator);
    expect(separator.getAttribute('aria-valuenow')).toBe('240');

    fireEvent.pointerDown(separator, { clientX: 240, pointerId: 2 });
    const [hideOutline] = view.getAllByRole('button', {
      name: '收起大纲'
    });
    if (!hideOutline) throw new Error('hide-outline-control-unavailable');
    fireEvent.click(hideOutline);
    expect(document.body.style.cursor).toBe('');
    expect(document.body.style.userSelect).toBe('');
    fireEvent.mouseMove(document, { clientX: 320 });
    fireEvent.mouseUp(document);
  });

  it('applies immersive presentation settings to the real outline and scroll owners', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '编辑器设置' }));

    fireEvent.click(view.getByRole('checkbox', { name: '文章大纲' }));
    fireEvent.click(view.getByRole('checkbox', { name: '分屏预览' }));
    expect(
      view.container
        .querySelector('.easymde-editor')
        ?.classList.contains('is-immersive-source')
    ).toBe(true);
    fireEvent.click(view.getByRole('checkbox', { name: '分屏预览' }));
    expect(
      view.container
        .querySelector('.easymde-editor')
        ?.classList.contains('is-immersive-split')
    ).toBe(true);
    expect(view.queryByRole('complementary', { name: '文章大纲' })).toBeNull();
    expect(
      view.container.querySelector('.easymde-immersive-stats')
    ).not.toBeNull();
    expect(view.getByText('自动保存已开启')).not.toBeNull();
    expect(props.scrollSyncPort.prepareBinding).toHaveBeenCalledTimes(4);
    expect(props.scrollSyncBinding.dispose).toHaveBeenCalledTimes(3);
    expect(props.immersivePreferencesPort.write).toHaveBeenCalledTimes(1);
    expect(props.immersivePreferencesPort.write).toHaveBeenCalledWith({
      outline: false
    });
  });

  it.each([
    {
      characters: true,
      minutes: true,
      mode: 'detailed',
      words: true
    },
    {
      characters: true,
      minutes: false,
      mode: 'compact',
      words: false
    },
    {
      characters: false,
      minutes: false,
      mode: 'hidden',
      words: false
    }
  ] as const)(
    'links immersive statistics to the $mode global status mode',
    async ({ characters, minutes, mode, words }) => {
      const baseProps = fixture();
      const props = {
        ...baseProps,
        settings: {
          general: { ...baseProps.settings.general, statusBarMode: mode },
          markdown: baseProps.settings.markdown
        }
      };
      const view = render(<EditorRoot {...props} />);

      fireEvent.click(
        await view.findByRole('button', { name: '进入沉浸写作' })
      );

      expect(null !== view.queryByText('8 字符')).toBe(characters);
      expect(null !== view.queryByText('1 词')).toBe(words);
      expect(null !== view.queryByText('约 1 分钟')).toBe(minutes);
    }
  );

  it('keeps the disabled global auto-save setting authoritative in immersive mode', async () => {
    const baseProps = fixture();
    vi.mocked(baseProps.immersivePreferencesPort.read).mockReturnValue({
      preferences: {
        outline: true
      },
      status: 'loaded'
    });
    const props = {
      ...baseProps,
      settings: {
        general: {
          ...baseProps.settings.general,
          autoSave: false,
          syncScroll: false
        },
        markdown: baseProps.settings.markdown
      }
    };
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '编辑器设置' }));

    expect(view.queryByRole('checkbox', { name: '自动保存' })).toBeNull();
    expect(view.queryByText('自动保存已开启')).toBeNull();
    expect(view.queryByRole('checkbox', { name: '同步滚动' })).toBeNull();
    expect(props.scrollSyncPort.prepareBinding).not.toHaveBeenCalled();
    expect(baseProps.immersivePreferencesPort.write).not.toHaveBeenCalled();

    fireEvent.click(view.getByRole('checkbox', { name: '文章大纲' }));
    expect(baseProps.immersivePreferencesPort.write).toHaveBeenCalledWith({
      outline: false
    });
    expect(baseProps.immersivePreferencesPort.write).toHaveBeenCalledTimes(1);
  });

  it('keeps global auto save authoritative when retired immersive preferences are absent', async () => {
    const props = fixture();
    vi.mocked(props.immersivePreferencesPort.read).mockReturnValue({
      preferences: {
        outline: true
      },
      status: 'loaded'
    });
    const view = render(<EditorRoot {...props} />);
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));

    fireEvent.click(view.getByRole('button', { name: '编辑器设置' }));
    expect(view.getByText('自动保存已开启')).not.toBeNull();
    expect(view.queryByRole('checkbox', { name: '同步滚动' })).toBeNull();
    expect(
      view.container
        .querySelector('.easymde-editor')
        ?.classList.contains('is-immersive-split')
    ).toBe(true);
    expect(props.scrollSyncPort.prepareBinding).toHaveBeenCalled();

    fireEvent.click(view.getByRole('button', { name: 'Bold' }));
    await act(
      () => new Promise((resolve) => globalThis.setTimeout(resolve, 600))
    );
    expect(props.localDraftStorage.write).toHaveBeenCalled();
  });

  it('maps Settings Center editing modes to immersive modes and rereads only outline preferences', async () => {
    const props = fixture();
    const modes = [
      ['live-preview', 'is-immersive-split'],
      ['source', 'is-immersive-source'],
      ['preview', 'is-immersive-preview']
    ] as const;

    for (const [editingMode, expectedClass] of modes) {
      const view = render(
        <EditorRoot
          {...props}
          settings={{
            ...props.settings,
            general: { ...props.settings.general, editingMode }
          }}
        />
      );

      fireEvent.click(
        await view.findByRole('button', { name: '进入沉浸写作' })
      );
      expect(
        view.container
          .querySelector('.easymde-editor')
          ?.classList.contains(expectedClass)
      ).toBe(true);
      expect(props.immersivePreferencesPort.read).toHaveBeenCalled();
      view.unmount();
    }
  });

  it('keeps the split preview control synchronized with top mode buttons without persisting it', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '编辑器设置' }));

    const splitPreview = view.getByRole('checkbox', { name: '分屏预览' });
    expect(splitPreview.getAttribute('aria-checked')).toBe('true');

    fireEvent.click(view.getByRole('button', { name: /^编辑$/u }));
    expect(
      view.container
        .querySelector('.easymde-editor')
        ?.classList.contains('is-immersive-source')
    ).toBe(true);
    expect(splitPreview.getAttribute('aria-checked')).toBe('false');

    fireEvent.click(view.getByRole('button', { name: /^分屏$/u }));
    expect(
      view.container
        .querySelector('.easymde-editor')
        ?.classList.contains('is-immersive-split')
    ).toBe(true);
    expect(splitPreview.getAttribute('aria-checked')).toBe('true');
    expect(props.immersivePreferencesPort.write).not.toHaveBeenCalled();
  });

  it('retains a temporary immersive mode across same-page exit and re-entry', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: /^预览$/u }));
    expect(
      view.container
        .querySelector('.easymde-editor')
        ?.classList.contains('is-immersive-preview')
    ).toBe(true);

    fireEvent.click(view.getByRole('button', { name: '退出沉浸写作' }));
    expect(view.queryByRole('region', { name: '沉浸写作' })).toBeNull();

    fireEvent.click(view.getByRole('button', { name: '进入沉浸写作' }));
    expect(
      view.container
        .querySelector('.easymde-editor')
        ?.classList.contains('is-immersive-preview')
    ).toBe(true);
  });

  it('lets the user discard an unreadable local draft and unblock storage ownership', async () => {
    const props = fixture();
    vi.mocked(props.localDraftStorage.read).mockReturnValue({
      code: 'local-draft-payload-invalid',
      status: 'failed'
    });
    const view = render(<EditorRoot {...props} />);

    expect(view.getByText('Draft read failed')).not.toBeNull();
    await act(async () => {
      fireEvent.click(view.getByRole('button', { name: 'Discard draft' }));
    });

    expect(props.localDraftStorage.discard).toHaveBeenCalledOnce();
    expect(view.queryByRole('button', { name: 'Discard draft' })).toBeNull();
  });

  it('flushes the React document before native form serialization and releases the bridge', () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);
    const input = view.container.querySelector<HTMLElement>('.cm-content');
    const editor = input ? EditorView.findFromDOM(input) : null;
    expect(editor).not.toBeNull();

    editor?.dispatch({
      changes: {
        from: 0,
        to: editor.state.doc.length,
        insert: 'current editor value'
      }
    });
    props.submissionField.value = 'stale native value';
    props.nativeForm.dispatchEvent(
      new SubmitEvent('submit', { bubbles: true, cancelable: true })
    );
    expect(props.submissionField.value).toBe('current editor value');

    view.unmount();
    props.submissionField.value = 'after teardown';
    props.nativeForm.dispatchEvent(
      new SubmitEvent('submit', { bubbles: true, cancelable: true })
    );
    expect(props.submissionField.value).toBe('after teardown');
  });

  it('tracks the WordPress session and blocks new protected native and React operations', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);
    const input = view.container.querySelector<HTMLElement>('.cm-content');
    const editor = input ? EditorView.findFromDOM(input) : null;
    editor?.dispatch({
      changes: {
        from: 0,
        to: editor.state.doc.length,
        insert: 'unsaved session value'
      }
    });
    props.submissionField.value = 'preserved unsaved value';

    act(() => props.sessionEmit('locked'));

    expect(
      view.container
        .querySelector('[data-easymde-editor-owner="react"]')
        ?.getAttribute('data-easymde-session-status')
    ).toBe('locked');
    const nativeEvent = new SubmitEvent('submit', {
      bubbles: true,
      cancelable: true
    });
    expect(props.nativeForm.dispatchEvent(nativeEvent)).toBe(false);
    expect(props.submissionField.value).toBe('preserved unsaved value');

    expect(props.onFailure).toHaveBeenCalledWith('editor-session-locked');

    act(() => props.sessionEmit('authentication-required'));
    fireEvent.click(view.getByRole('button', { name: 'Image' }));
    await waitFor(() =>
      expect(props.mediaPickerFrame?.open).not.toHaveBeenCalled()
    );
    expect(props.submissionField.value).toBe('preserved unsaved value');
  });

  it('keeps the dirty baseline and recovery data until WordPress confirms persistence on the next bootstrap', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);
    const input = view.container.querySelector<HTMLElement>('.cm-content');
    const editor = input ? EditorView.findFromDOM(input) : null;
    editor?.dispatch({
      changes: {
        from: 0,
        to: editor.state.doc.length,
        insert: 'not persisted'
      }
    });
    await waitFor(() =>
      expect(props.localDraftStorage.write).toHaveBeenCalledWith(
        'not persisted'
      )
    );

    props.nativeForm.dispatchEvent(
      new SubmitEvent('submit', { bubbles: true, cancelable: true })
    );

    expect(props.localDraftStorage.discard).not.toHaveBeenCalled();
  });

  it('reports a render failure without leaving a partial editor owner', () => {
    const props = fixture();
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const preventSyntheticError = (event: ErrorEvent) => event.preventDefault();
    window.addEventListener('error', preventSyntheticError);

    try {
      const view = render(
        <EditorRootErrorBoundary
          failureMessage="The editor could not start."
          onFailure={props.onFailure}
        >
          <BrokenEditorRoot />
        </EditorRootErrorBoundary>
      );

      expect(props.onFailure).toHaveBeenCalledWith(
        'react-editor-render-failed'
      );
      expect(view.getByRole('alert').textContent).toBe(
        'The editor could not start.'
      );
    } finally {
      window.removeEventListener('error', preventSyntheticError);
      consoleError.mockRestore();
    }
  });

  it('closes ordinary Settings when the heading menu opens and runs its command', async () => {
    const props = fixture();
    const toolbar = {
      ...props.toolbar,
      commands: [
        ...props.toolbar.commands,
        {
          action: 'heading',
          group: 'heading',
          icon: 'heading',
          id: 'heading1',
          label: 'Heading 1',
          level: 1,
          surface: 'heading-menu'
        }
      ]
    } as const;
    const view = render(<EditorRoot {...props} toolbar={toolbar} />);
    const headings = view.getByRole('button', { name: 'Headings' });
    const settings = view.getByRole('button', { name: '编辑器设置' });

    fireEvent.click(settings);
    expect(settings.getAttribute('aria-expanded')).toBe('true');

    fireEvent.mouseDown(headings);
    fireEvent.click(headings, { detail: 1 });
    expect(settings.getAttribute('aria-expanded')).toBe('false');
    const headingItem = view.getByRole('menuitem', { name: 'Heading 1' });
    expect(document.activeElement).toBe(headings);
    fireEvent.click(headingItem);
  });

  it('reuses Preview HTML for equivalent article markup and prepares code CSS without enhancing', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);
    await waitFor(() =>
      expect(props.previewPort.render).toHaveBeenCalledTimes(1)
    );
    const renderCount = vi.mocked(props.previewPort.render).mock.calls.length;
    const enhanceCount = vi.mocked(props.enhancementPort.enhance).mock.calls
      .length;
    const sink = view.container.querySelector(
      '[data-easymde-preview-html-sink]'
    );

    fireEvent.click(view.getByRole('button', { name: '编辑器设置' }));
    fireEvent.click(view.getByRole('combobox', { name: 'Article theme' }));
    fireEvent.click(view.getByRole('option', { name: 'Newsprint' }));

    await waitFor(() =>
      expect(
        view.container
          .querySelector('[data-easymde-preview-html-sink]')
          ?.classList.contains('easymde-markdown-theme-newsprint')
      ).toBe(true)
    );
    expect(
      view.container.querySelector('[data-easymde-preview-html-sink]')
    ).toBe(sink);
    expect(props.previewPort.render).toHaveBeenCalledTimes(renderCount);

    fireEvent.click(view.getByRole('combobox', { name: 'Code theme' }));
    fireEvent.click(view.getByRole('option', { name: 'GitHub' }));
    await waitFor(() =>
      expect(props.enhancementPort.prepareCodeTheme).toHaveBeenCalledWith(
        expect.objectContaining({
          codeTheme: 'github',
          signal: expect.any(AbortSignal)
        })
      )
    );
    await waitFor(() =>
      expect(
        props.enhancementPort.syncCodeFrameBackgrounds
      ).toHaveBeenCalledWith(sink)
    );
    expect(props.previewPort.render).toHaveBeenCalledTimes(renderCount);
    expect(props.enhancementPort.enhance).toHaveBeenCalledTimes(enhanceCount);
  });

  it('keeps code theme authority unchanged after preparation failure and retries the same theme', async () => {
    const props = fixture();
    const nativeFields = {
      codeTheme: 'atom-one-dark',
      codeThemeExplicit: '0'
    };
    vi.mocked(props.appearancePort.applyState).mockImplementation(
      async (state, explicit) => {
        nativeFields.codeTheme = state.codeTheme;
        nativeFields.codeThemeExplicit = explicit ? '1' : '0';
        return true;
      }
    );
    vi.mocked(props.enhancementPort.prepareCodeTheme).mockRejectedValueOnce(
      new Error('preview-enhancement-resource-load-failed')
    );
    const prepared = { cancel: vi.fn(), commit: vi.fn() };
    vi.mocked(props.enhancementPort.prepareCodeTheme).mockResolvedValueOnce(
      prepared
    );
    const view = render(<EditorRoot {...props} />);
    await waitFor(() =>
      expect(props.previewPort.render).toHaveBeenCalledTimes(1)
    );

    fireEvent.click(view.getByRole('button', { name: '编辑器设置' }));
    fireEvent.click(view.getByRole('combobox', { name: 'Code theme' }));
    fireEvent.click(view.getByRole('option', { name: 'GitHub' }));

    await waitFor(() =>
      expect(props.onFailure).toHaveBeenCalledWith(
        'preview-enhancement-resource-load-failed'
      )
    );
    const sink = view.container.querySelector(
      '[data-easymde-preview-html-sink]'
    );
    expect(sink?.classList.contains('easymde-code-theme-atom-one-dark')).toBe(
      true
    );
    expect(sink?.classList.contains('easymde-code-theme-github')).toBe(false);
    expect(props.appearancePort.applyState).not.toHaveBeenCalled();
    expect(nativeFields).toEqual({
      codeTheme: 'atom-one-dark',
      codeThemeExplicit: '0'
    });
    expect(
      view.getByRole('combobox', { name: 'Code theme' }).textContent
    ).toContain('Atom One Dark');

    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(view.getByRole('button', { name: '进入沉浸写作' }));
    expect(view.getByText('已保存')).not.toBeNull();
    fireEvent.click(view.getByRole('button', { name: '退出沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '编辑器设置' }));

    fireEvent.click(view.getByRole('combobox', { name: 'Code theme' }));
    fireEvent.click(view.getByRole('option', { name: 'GitHub' }));

    await waitFor(() =>
      expect(props.enhancementPort.prepareCodeTheme).toHaveBeenCalledTimes(2)
    );
    await waitFor(() =>
      expect(props.appearancePort.applyState).toHaveBeenCalledWith(
        {
          codeTheme: 'github',
          customCssId: '',
          markdownTheme: 'default'
        },
        true
      )
    );
    await waitFor(() =>
      expect(sink?.classList.contains('easymde-code-theme-github')).toBe(true)
    );
    expect(nativeFields).toEqual({
      codeTheme: 'github',
      codeThemeExplicit: '1'
    });
    expect(prepared.commit).toHaveBeenCalledTimes(1);
    expect(prepared.cancel).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(view.getByRole('button', { name: '进入沉浸写作' }));
    expect(view.getByText('未保存')).not.toBeNull();
  });

  it('cancels superseded code CSS preparation and commits only the latest theme', async () => {
    const props = fixture();
    const github =
      deferred<Readonly<{ cancel: () => void; commit: () => void }>>();
    const terminal =
      deferred<Readonly<{ cancel: () => void; commit: () => void }>>();
    const githubTransaction = { cancel: vi.fn(), commit: vi.fn() };
    const terminalTransaction = { cancel: vi.fn(), commit: vi.fn() };
    const signals = new Map<string, AbortSignal>();
    vi.mocked(props.enhancementPort.prepareCodeTheme).mockImplementation(
      ({ codeTheme, signal }) => {
        signals.set(codeTheme, signal);
        return 'github' === codeTheme ? github.promise : terminal.promise;
      }
    );
    const appearance = {
      ...props.appearance,
      codeThemes: [
        ...props.appearance.codeThemes,
        { id: 'terminal-noir', label: 'Terminal Noir' }
      ]
    };
    const view = render(<EditorRoot {...props} appearance={appearance} />);
    await waitFor(() =>
      expect(props.previewPort.render).toHaveBeenCalledTimes(1)
    );
    const renderCount = vi.mocked(props.previewPort.render).mock.calls.length;

    fireEvent.click(view.getByRole('button', { name: '编辑器设置' }));
    fireEvent.click(view.getByRole('combobox', { name: 'Code theme' }));
    fireEvent.click(view.getByRole('option', { name: 'GitHub' }));
    await waitFor(() => expect(signals.has('github')).toBe(true));

    fireEvent.click(view.getByRole('combobox', { name: 'Code theme' }));
    fireEvent.click(view.getByRole('option', { name: 'Terminal Noir' }));
    await waitFor(() => expect(signals.has('terminal-noir')).toBe(true));
    expect(signals.get('github')?.aborted).toBe(true);
    expect(props.appearancePort.cancelPendingApply).toHaveBeenCalledTimes(2);

    await act(async () => github.resolve(githubTransaction));
    expect(
      view.container
        .querySelector('[data-easymde-preview-html-sink]')
        ?.classList.contains('easymde-code-theme-github')
    ).toBe(false);
    expect(
      props.enhancementPort.syncCodeFrameBackgrounds
    ).not.toHaveBeenCalled();
    expect(githubTransaction.cancel).toHaveBeenCalledTimes(1);
    expect(githubTransaction.commit).not.toHaveBeenCalled();

    await act(async () => terminal.resolve(terminalTransaction));
    await waitFor(() =>
      expect(
        view.container
          .querySelector('[data-easymde-preview-html-sink]')
          ?.classList.contains('easymde-code-theme-terminal-noir')
      ).toBe(true)
    );
    await waitFor(() =>
      expect(
        props.enhancementPort.syncCodeFrameBackgrounds
      ).toHaveBeenCalledWith(
        view.container.querySelector('[data-easymde-preview-html-sink]')
      )
    );
    expect(
      props.enhancementPort.syncCodeFrameBackgrounds
    ).toHaveBeenCalledTimes(1);
    expect(terminalTransaction.commit).toHaveBeenCalledTimes(1);
    expect(terminalTransaction.cancel).not.toHaveBeenCalled();
    expect(props.previewPort.render).toHaveBeenCalledTimes(renderCount);
  });

  it('rerenders Preview when the article markup profile changes', async () => {
    const props = fixture();
    const appearance = {
      ...props.appearance,
      articleThemes: props.appearance.articleThemes.map((theme) => ({
        ...theme,
        markupProfile:
          'newsprint' === theme.id ? 'markdown2html-v1' : 'common-v1'
      }))
    };
    const view = render(<EditorRoot {...props} appearance={appearance} />);
    await waitFor(() =>
      expect(props.previewPort.render).toHaveBeenCalledTimes(1)
    );

    fireEvent.click(view.getByRole('button', { name: '编辑器设置' }));
    fireEvent.click(view.getByRole('combobox', { name: 'Article theme' }));
    fireEvent.click(view.getByRole('option', { name: 'Newsprint' }));

    await waitFor(() => {
      expect(props.previewPort.render).toHaveBeenCalledTimes(2);
      expect(props.previewPort.render).toHaveBeenLastCalledWith(
        expect.objectContaining({ markdownTheme: 'newsprint' }),
        expect.any(AbortSignal)
      );
    });
  });

  it('does not let a late native bridge event duplicate an article theme refresh', async () => {
    const props = fixture();
    const appearance = {
      ...props.appearance,
      articleThemes: props.appearance.articleThemes.map((theme) => ({
        ...theme,
        markupProfile:
          'newsprint' === theme.id ? 'markdown2html-v1' : 'common-v1'
      }))
    };
    const view = render(<EditorRoot {...props} appearance={appearance} />);
    await waitFor(() =>
      expect(props.previewPort.render).toHaveBeenCalledTimes(1)
    );

    fireEvent.click(view.getByRole('button', { name: '编辑器设置' }));
    fireEvent.click(view.getByRole('combobox', { name: 'Article theme' }));
    fireEvent.click(view.getByRole('option', { name: 'Newsprint' }));
    await waitFor(() =>
      expect(props.previewPort.render).toHaveBeenCalledTimes(2)
    );

    vi.useFakeTimers();
    try {
      props.submissionField.dispatchEvent(
        new Event('input', { bubbles: true })
      );
      act(() => vi.advanceTimersByTime(180));
      expect(props.previewPort.render).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('preserves an explicit code theme when Appearance remounts in immersive mode', async () => {
    const props = fixture();
    const codeThemeExplicitField = document.createElement('input');
    codeThemeExplicitField.value = '0';
    const appearance = {
      ...props.appearance,
      articleThemes: props.appearance.articleThemes.map((theme) => ({
        ...theme,
        defaultCodeTheme:
          'newsprint' === theme.id ? 'github' : theme.defaultCodeTheme
      })),
      codeThemes: [
        ...props.appearance.codeThemes,
        { id: 'terminal-noir', label: 'Terminal Noir' }
      ]
    };
    vi.mocked(props.appearancePort.applyState).mockImplementation(
      async (_state, explicit) => {
        codeThemeExplicitField.value = explicit ? '1' : '0';
        return true;
      }
    );
    const view = render(<EditorRoot {...props} appearance={appearance} />);

    fireEvent.click(await view.findByRole('button', { name: '编辑器设置' }));
    fireEvent.click(view.getByRole('combobox', { name: 'Code theme' }));
    fireEvent.click(view.getByRole('option', { name: 'Terminal Noir' }));
    await waitFor(() => expect(codeThemeExplicitField.value).toBe('1'));
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(view.getByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '主题' }));
    fireEvent.click(view.getByRole('button', { name: 'Article theme' }));
    fireEvent.click(view.getByRole('option', { name: 'Newsprint' }));

    await waitFor(() =>
      expect(props.appearancePort.applyState).toHaveBeenLastCalledWith(
        expect.objectContaining({
          codeTheme: 'terminal-noir',
          markdownTheme: 'newsprint'
        }),
        true
      )
    );
    expect(codeThemeExplicitField.value).toBe('1');
  });

  it('preserves an explicit code theme when Appearance remounts in ordinary mode', async () => {
    const props = fixture();
    const codeThemeExplicitField = document.createElement('input');
    codeThemeExplicitField.value = '0';
    const appearance = {
      ...props.appearance,
      articleThemes: props.appearance.articleThemes.map((theme) => ({
        ...theme,
        defaultCodeTheme:
          'newsprint' === theme.id ? 'github' : theme.defaultCodeTheme
      })),
      codeThemes: [
        ...props.appearance.codeThemes,
        { id: 'terminal-noir', label: 'Terminal Noir' }
      ]
    };
    vi.mocked(props.appearancePort.applyState).mockImplementation(
      async (_state, explicit) => {
        codeThemeExplicitField.value = explicit ? '1' : '0';
        return true;
      }
    );
    const view = render(<EditorRoot {...props} appearance={appearance} />);

    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '主题' }));
    fireEvent.click(view.getByRole('button', { name: 'Code theme' }));
    fireEvent.click(view.getByRole('option', { name: 'Terminal Noir' }));
    await waitFor(() => expect(codeThemeExplicitField.value).toBe('1'));
    fireEvent.click(view.getByRole('button', { name: '退出沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '编辑器设置' }));
    fireEvent.click(view.getByRole('combobox', { name: 'Article theme' }));
    fireEvent.click(view.getByRole('option', { name: 'Newsprint' }));

    await waitFor(() =>
      expect(props.appearancePort.applyState).toHaveBeenLastCalledWith(
        expect.objectContaining({
          codeTheme: 'terminal-noir',
          markdownTheme: 'newsprint'
        }),
        true
      )
    );
    expect(codeThemeExplicitField.value).toBe('1');
  });

  it('preserves a named CSS theme saved in immersive mode after returning to the ordinary editor', async () => {
    const props = fixture();
    const savedSnapshot = {
      customCss: [
        {
          articleThemeName: 'Writer Article',
          codeThemeName: 'Writer Code',
          css: '.note { color: navy; }',
          id: 'writer-css',
          scopedCss: '.easymde-rendered-content .note { color: navy; }'
        }
      ],
      state: {
        codeTheme: 'atom-one-dark',
        customCssId: 'writer-css',
        markdownTheme: 'custom'
      }
    } as const;
    const appearancePort = {
      ...props.appearancePort,
      saveCustomCss: vi.fn().mockResolvedValue({
        snapshot: savedSnapshot,
        status: 'saved' as const
      })
    };
    const view = render(
      <EditorRoot {...props} appearancePort={appearancePort} />
    );

    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '主题' }));
    fireEvent.click(view.getByRole('button', { name: 'Custom CSS theme' }));
    fireEvent.change(
      view.getByRole('textbox', {
        name: 'Article theme name'
      }),
      {
        target: { value: 'Writer Article' }
      }
    );
    fireEvent.click(view.getByRole('button', { name: /Custom CSS code/ }));
    fireEvent.change(view.getByRole('textbox', { name: 'Custom CSS code' }), {
      target: { value: '.note { color: navy; }' }
    });
    fireEvent.click(view.getByRole('button', { name: 'Apply theme' }));
    await waitFor(() => {
      expect(appearancePort.saveCustomCss).toHaveBeenCalledOnce();
      expect(appearancePort.saveCustomCss).toHaveBeenCalledWith(
        expect.objectContaining({
          articleThemeName: 'Writer Article',
          codeThemeName: 'EasyMDE Blue Code'
        })
      );
      expect(appearancePort.applyState).toHaveBeenCalledOnce();
      expect(
        view.queryByRole('dialog', { name: 'Custom CSS theme' })
      ).toBeNull();
    });

    fireEvent.click(view.getByRole('button', { name: '退出沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '编辑器设置' }));

    const articleTheme = view.getByRole('combobox', {
      name: 'Article theme'
    });
    expect(articleTheme.textContent).toContain('Writer Article');
    fireEvent.click(articleTheme);
    expect(
      view
        .getByRole('option', { name: 'Writer Article' })
        .getAttribute('aria-selected')
    ).toBe('true');
  });

  it('carries an ordinary appearance choice into immersive mode', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(await view.findByRole('button', { name: '编辑器设置' }));
    fireEvent.click(view.getByRole('combobox', { name: 'Article theme' }));
    fireEvent.click(view.getByRole('option', { name: 'Newsprint' }));
    await waitFor(() =>
      expect(props.appearancePort.applyState).toHaveBeenLastCalledWith(
        expect.objectContaining({ markdownTheme: 'newsprint' }),
        false
      )
    );
    fireEvent.keyDown(window, { key: 'Escape' });

    fireEvent.click(view.getByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '主题' }));

    expect(
      view.getByRole('button', { name: 'Article theme' }).textContent
    ).toContain('Newsprint');
  });

  it('carries an ordinary font choice into immersive mode', async () => {
    const props = fixture();
    const fonts = {
      ...props.fonts,
      options: {
        ...props.fonts.options,
        customFonts: [
          ...props.fonts.options.customFonts,
          {
            fontFamily: 'Optima, sans-serif',
            id: 'optima',
            label: 'Optima'
          }
        ]
      }
    };
    const view = render(<EditorRoot {...props} fonts={fonts} />);

    const prepare = props.wechatClipboard.prepare;
    if (!prepare) throw new Error('wechat preparation is unavailable');
    const preparation = vi.mocked(prepare);
    const preparationCallsBeforeFontChange = preparation.mock.calls.length;
    fireEvent.click(await view.findByRole('button', { name: '编辑器设置' }));
    fireEvent.click(view.getByRole('combobox', { name: 'Custom font' }));
    fireEvent.click(view.getByRole('option', { name: 'Optima' }));
    await waitFor(() =>
      expect(
        preparation.mock.calls
          .slice(preparationCallsBeforeFontChange)
          .some(
            ([surface]) =>
              surface
              === view.container.querySelector(
                '[data-easymde-preview-html-sink="1"]'
              )
          )
      ).toBe(true)
    );
    fireEvent.keyDown(window, { key: 'Escape' });

    fireEvent.click(view.getByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: 'Font' }));

    expect(
      view.getByRole('button', { name: 'Custom font' }).textContent
    ).toContain('Optima');
  });

  it('applies theme classes and theme font defaults to the single Preview sink', async () => {
    const props = fixture();
    const appearance = {
      ...props.appearance,
      articleThemes: props.appearance.articleThemes.map((theme) =>
        'newsprint' === theme.id
          ? {
              fontDefaults: {
                appleFont: 'new-york',
                customFont: 'inter',
                serifFont: 'on',
                windowsFont: 'segoe-ui'
              },
              defaultCodeTheme: theme.defaultCodeTheme,
              id: 'newsprint',
              label: 'Newsprint',
              markupProfile: theme.markupProfile
            }
          : theme
      )
    };
    const fonts = {
      ...props.fonts,
      options: {
        appleFonts: [
          ...props.fonts.options.appleFonts,
          {
            fontFamily: '"New York"',
            id: 'new-york',
            label: 'New York'
          }
        ],
        customFonts: [
          ...props.fonts.options.customFonts,
          {
            fontFamily: 'Inter, sans-serif',
            id: 'inter',
            label: 'Inter'
          }
        ],
        serifOptions: [
          ...props.fonts.options.serifOptions,
          {
            fontFamily: 'Georgia, serif',
            id: 'on',
            label: 'On'
          }
        ],
        windowsFonts: [
          ...props.fonts.options.windowsFonts,
          {
            fontFamily: '"Segoe UI"',
            id: 'segoe-ui',
            label: 'Segoe UI'
          }
        ]
      }
    };
    const view = render(
      <EditorRoot {...props} appearance={appearance} fonts={fonts} />
    );

    fireEvent.click(view.getByRole('button', { name: '编辑器设置' }));
    fireEvent.click(view.getByRole('combobox', { name: 'Article theme' }));
    fireEvent.click(view.getByRole('option', { name: 'Newsprint' }));

    await waitFor(() => {
      expect(props.fontControlsPort.applyState).toHaveBeenCalledWith(
        appearance.articleThemes[1]?.fontDefaults
      );
    });
    const sink = view.container.querySelector<HTMLElement>(
      '[data-easymde-preview-html-sink="1"]'
    );
    expect(sink?.classList.contains('easymde-markdown-theme-newsprint')).toBe(
      true
    );
    expect(sink?.classList.contains('easymde-code-theme-atom-one-dark')).toBe(
      true
    );
    expect(sink?.style.getPropertyValue('--easymde-content-font-family')).toBe(
      'Inter, sans-serif, "Segoe UI", "New York", Georgia, serif'
    );
  });

  it('routes Preview enhancement diagnostics through the Root failure owner', async () => {
    const props = fixture();
    vi.mocked(props.enhancementPort.enhance).mockRejectedValue(
      new Error('preview-enhancement-resource-load-failed')
    );

    render(<EditorRoot {...props} />);

    await waitFor(() => {
      expect(props.onFailure).toHaveBeenCalledWith(
        'preview-enhancement-resource-load-failed'
      );
    });
  });

  it('opens WordPress Media from the Image command and inserts the selected attachment', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(view.getByRole('button', { name: 'Image' }));
    fireEvent.click(view.getByRole('button', { name: 'Image' }));
    const frame = props.mediaPickerFrame;
    expect(frame).not.toBeNull();
    if (!frame) {
      throw new Error('missing synthetic media frame');
    }
    expect(frame.open).toHaveBeenCalledTimes(1);
    vi.mocked(frame.open).mock.calls[0]?.[0].onSelect({
      alt: 'Selected image',
      url: 'https://example.test/selected.png'
    });
    vi.mocked(frame.open).mock.calls[0]?.[0].onClose();

    await waitFor(() => {
      expect(props.submissionField.value).toBe(
        '![image](https://example.test/selected.png)'
      );
    });
    expect(props.executeExternalCommand).not.toHaveBeenCalled();
  });

  it('maps a visual Preview selection before handing Image to WordPress Media', async () => {
    const props = fixture();
    props.submissionField.value = 'Choose **this** text';
    props.submissionField.defaultValue = 'Choose **this** text';
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      Promise.resolve(
        createPreviewResponse(
          request,
          '<p>Choose <strong>this</strong> text</p>' as SafePreviewHtml,
          {}
        )
      )
    );
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
    fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
    const visualEditor = await view.findByRole('textbox', {
      name: '可视化文章编辑器'
    });
    const selectedText = visualEditor.querySelector('strong')?.firstChild;
    if (!selectedText) {
      throw new Error('missing synthetic visual selection target');
    }
    const range = document.createRange();
    range.selectNodeContents(selectedText);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    fireEvent.click(view.getByRole('button', { name: 'Image' }));
    const frame = props.mediaPickerFrame;
    if (!frame) {
      throw new Error('missing synthetic media frame');
    }
    vi.mocked(frame.open).mock.calls[0]?.[0].onSelect({
      alt: 'Selected image',
      url: 'https://example.test/selected.png'
    });
    vi.mocked(frame.open).mock.calls[0]?.[0].onClose();

    await waitFor(() => {
      expect(props.submissionField.value).toBe(
        'Choose **![image](https://example.test/selected.png)** text'
      );
    });
  });

  it('fails the Image toolbar command when the visual selection is unavailable', async () => {
    const props = fixture();
    props.submissionField.value = 'Choose **this** text';
    props.submissionField.defaultValue = 'Choose **this** text';
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      Promise.resolve(
        createPreviewResponse(
          request,
          '<p>Choose <strong>this</strong> text</p>' as SafePreviewHtml,
          {}
        )
      )
    );
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
    fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
    const visualEditor = await view.findByRole('textbox', {
      name: '可视化文章编辑器'
    });
    const getSelection = vi.spyOn(window, 'getSelection').mockReturnValue(null);

    try {
      fireEvent.click(view.getByRole('button', { name: 'Image' }));

      expect(props.mediaPickerFrame?.open).not.toHaveBeenCalled();
      expect(props.executeExternalCommand).not.toHaveBeenCalled();
      expect(
        view.getByRole('textbox', {
          name: '可视化文章编辑器'
        })
      ).toBe(visualEditor);
      expect(props.submissionField.value).toBe('Choose **this** text');
      expect(props.onFailure).toHaveBeenCalledWith(
        'visual-editor-selection-unavailable'
      );
      expect(view.getByRole('alert').textContent).toBe(
        contextMenuStrings.statusActionFailed
      );
    } finally {
      getSelection.mockRestore();
      view.unmount();
    }
  });

  it('keeps a failed visual toolbar command in Visual mode without a Source fallback', async () => {
    const source = 'Before **selected** after\n\n$$x^2$$';
    const props = fixture();
    props.submissionField.value = source;
    props.submissionField.defaultValue = source;
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      Promise.resolve(
        createPreviewResponse(
          request,
          '<p>Before <strong>selected</strong> after</p><div class="easymde-math easymde-math-block">$$x^2$$</div>' as SafePreviewHtml,
          { math: true }
        )
      )
    );
    vi.mocked(props.enhancementPort.enhance).mockImplementation(
      async (surface) => {
        const math = surface.querySelector<HTMLElement>('.easymde-math');
        if (math) {
          math.innerHTML = '<span class="katex">rendered math</span>';
          math.dataset.easymdeRendered = '1';
        }
      }
    );
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
    fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
    const visualEditor = await view.findByRole('textbox', {
      name: '可视化文章编辑器'
    });
    const selectedText = visualEditor.querySelector('strong')?.firstChild;
    const math = visualEditor.querySelector<HTMLElement>('.easymde-math');
    if (!(selectedText instanceof Text) || !math) {
      throw new Error('visual-failure-fixture-missing');
    }
    const range = document.createRange();
    range.selectNodeContents(selectedText);
    const nativeSelection = window.getSelection();
    nativeSelection?.removeAllRanges();
    nativeSelection?.addRange(range);
    visualEditor.focus();
    nativeSelection?.removeAllRanges();
    nativeSelection?.addRange(range);
    const beforeSelection = {
      endOffset: range.endOffset,
      startOffset: range.startOffset,
      text: range.toString()
    };
    const beforePreviewRenders = vi.mocked(props.previewPort.render).mock.calls
      .length;

    math.innerHTML = '<span class="katex">foreign</span>';
    fireEvent.mouseDown(view.getByRole('button', { name: 'Bold' }));
    fireEvent.click(view.getByRole('button', { name: 'Bold' }));

    await waitFor(() =>
      expect(props.onFailure).toHaveBeenCalledWith(
        'visual-editor-read-only-region-mutated'
      )
    );
    expect(view.getByRole('alert').textContent).toBe(
      contextMenuStrings.statusActionFailed
    );
    expect(props.submissionField.value).toBe(source);
    expect(vi.mocked(props.previewPort.render).mock.calls.length).toBe(
      beforePreviewRenders
    );
    expect(
      view.getByRole('textbox', {
        name: '可视化文章编辑器'
      })
    ).toBe(visualEditor);
    expect(document.activeElement).toBe(visualEditor);
    const afterSelection = window.getSelection();
    const afterRange = afterSelection?.rangeCount
      ? afterSelection.getRangeAt(0)
      : null;
    expect(afterRange).not.toBeNull();
    expect({
      endOffset: afterRange?.endOffset,
      startOffset: afterRange?.startOffset,
      text: afterRange?.toString()
    }).toEqual(beforeSelection);
    expect(props.executeExternalCommand).not.toHaveBeenCalled();
    view.unmount();
  });

  it('reports a stable visible Media failure without mutating Markdown', async () => {
    const props = fixture();
    const frame = props.mediaPickerFrame;
    if (!frame) {
      throw new Error('missing synthetic media frame');
    }
    vi.mocked(frame.open).mockImplementation(() => {
      throw new Error('private WordPress frame failure');
    });
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(view.getByRole('button', { name: 'Image' }));

    await waitFor(() => {
      expect(
        view.getByText('The media library could not be opened.')
      ).not.toBeNull();
      expect(props.onFailure).toHaveBeenCalledWith(
        'media-picker-operation-failed'
      );
    });
    expect(props.submissionField.value).toBe('selected');
  });

  it('owns image Paste upload status and releases the Source listener on teardown', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);
    const source = view.container.querySelector('.cm-content');
    expect(source).not.toBeNull();
    const paste = imageTransferEvent(
      'paste',
      new File(['image'], 'screen-shot.png', { type: 'image/png' })
    );

    source?.dispatchEvent(paste);
    expect(paste.defaultPrevented).toBe(true);
    await waitFor(() => {
      expect(view.getByText('Paste uploaded')).not.toBeNull();
      expect(props.submissionField.value).toBe(
        '![screen shot](https://example.test/upload.png)'
      );
    });

    view.unmount();
    const afterUnmount = imageTransferEvent(
      'paste',
      new File(['image'], 'ignored.png', { type: 'image/png' })
    );
    source?.dispatchEvent(afterUnmount);
    expect(props.imageUploadPort.upload).toHaveBeenCalledTimes(1);
  });

  it('imports one remote Markdown image from the source surface', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);
    const source = view.container.querySelector('.cm-content');
    expect(source).not.toBeNull();
    const paste = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(paste, 'clipboardData', {
      value: {
        files: [],
        getData: (type: string) =>
          'text/plain' === type
            ? '![remote](https://images.example.test/remote.png)'
            : '',
        items: []
      }
    });

    source?.dispatchEvent(paste);

    expect(paste.defaultPrevented).toBe(true);
    await waitFor(() => {
      expect(props.remoteImageImportPort.import).toHaveBeenCalledWith(
        expect.objectContaining({
          altText: 'remote',
          postId: 7,
          url: 'https://images.example.test/remote.png'
        })
      );
      expect(props.submissionField.value).toBe(
        '![remote image](https://example.test/imported.png)'
      );
    });
    expect(props.imageUploadPort.upload).not.toHaveBeenCalled();
  });

  it('blocks automatic image paste while preserving drag-and-drop upload', async () => {
    const baseProps = fixture();
    const props = {
      ...baseProps,
      imageUpload: {
        ...baseProps.imageUpload,
        autoUploadPastedImages: false
      }
    };
    const view = render(<EditorRoot {...props} />);
    const source = view.container.querySelector('.cm-content');
    expect(source).not.toBeNull();
    const file = new File(['image'], 'screen-shot.png', {
      type: 'image/png'
    });
    const paste = imageTransferEvent('paste', file);

    source?.dispatchEvent(paste);

    expect(paste.defaultPrevented).toBe(true);
    expect(props.imageUploadPort.upload).not.toHaveBeenCalled();
    expect(props.submissionField.value).toBe('selected');
    await waitFor(() => {
      expect(view.getByText('Paste upload disabled')).not.toBeNull();
    });

    const drop = imageTransferEvent('drop', file);
    source?.dispatchEvent(drop);

    expect(drop.defaultPrevented).toBe(true);
    await waitFor(() => {
      expect(props.imageUploadPort.upload).toHaveBeenCalledOnce();
      expect(props.submissionField.value).toBe(
        '![screen shot](https://example.test/upload.png)'
      );
    });
  });

  it('shows a dismissible error alert without inserting Markdown when backup retries are exhausted', async () => {
    const props = fixture();
    vi.mocked(props.imageUploadPort.upload).mockResolvedValue({
      code: 'easymde_image_hosting_backup_upload_failed',
      status: 'failed'
    });
    const view = render(<EditorRoot {...props} />);
    const source = view.container.querySelector('.cm-content');
    expect(source).not.toBeNull();

    source?.dispatchEvent(
      imageTransferEvent(
        'paste',
        new File(['image'], 'screen-shot.png', { type: 'image/png' })
      )
    );

    const alert = await view.findByRole('alert');
    expect(alert.textContent).toContain('Paste failed');
    expect(props.submissionField.value).not.toContain('![');
    fireEvent.click(within(alert).getByRole('button', { name: '关闭' }));
    expect(view.queryByRole('alert')).toBeNull();
  });

  it('preserves an upload error when the upload session remounts', async () => {
    const props = fixture();
    let uploadCount = 0;
    vi.mocked(props.imageUploadPort.upload).mockImplementation(() => {
      uploadCount += 1;
      if (1 === uploadCount) {
        return Promise.resolve({ code: 'request-failed', status: 'failed' });
      }
      return new Promise(() => undefined);
    });
    const view = render(<EditorRoot {...props} />);
    const source = view.container.querySelector('.cm-content');
    expect(source).not.toBeNull();

    source?.dispatchEvent(
      imageTransferEvent(
        'paste',
        new File(['first'], 'first.png', { type: 'image/png' })
      )
    );
    await waitFor(() => expect(view.getByText('Paste failed')).not.toBeNull());

    view.rerender(
      <EditorRoot {...props} imageUpload={{ ...props.imageUpload }} />
    );
    source?.dispatchEvent(
      imageTransferEvent(
        'paste',
        new File(['second'], 'second.png', { type: 'image/png' })
      )
    );

    await waitFor(() =>
      expect(props.imageUploadPort.upload).toHaveBeenCalledTimes(2)
    );
    expect(view.getByText('Paste failed')).not.toBeNull();
    expect(view.queryByText('Paste uploading')).toBeNull();
  });

  it('restores an available local draft and releases its storage subscription', async () => {
    const props = fixture();
    const unsubscribe = vi.fn();
    vi.mocked(props.localDraftStorage.subscribe).mockReturnValue(unsubscribe);
    vi.mocked(props.localDraftStorage.read).mockReturnValue({
      draft: {
        content: 'Recovered draft',
        contentHash: 'hash:Recovered draft',
        schemaVersion: 1,
        updatedAt: 2000
      },
      source: 'current',
      status: 'available'
    });
    const view = render(<EditorRoot {...props} />);

    expect(view.getByText('A newer local draft is available.')).not.toBeNull();
    fireEvent.click(view.getByRole('button', { name: 'Restore draft' }));

    await waitFor(() =>
      expect(props.submissionField.value).toBe('Recovered draft')
    );
    expect(view.getByText('Draft restored')).not.toBeNull();
    view.unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('keeps local draft recovery notices out of the immersive surface', async () => {
    const props = fixture();
    vi.mocked(props.localDraftStorage.read).mockReturnValue({
      draft: {
        content: 'Recovered draft',
        contentHash: 'hash:Recovered draft',
        schemaVersion: 1,
        updatedAt: 2000
      },
      source: 'current',
      status: 'available'
    });
    const view = render(<EditorRoot {...props} />);

    expect(view.getByText('A newer local draft is available.')).not.toBeNull();
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));

    expect(view.queryByText('A newer local draft is available.')).toBeNull();
    expect(view.queryByRole('button', { name: 'Restore draft' })).toBeNull();
    expect(view.queryByRole('button', { name: 'Discard draft' })).toBeNull();

    fireEvent.click(view.getByRole('button', { name: '退出沉浸写作' }));
    expect(view.getByText('A newer local draft is available.')).not.toBeNull();
    expect(view.getByRole('button', { name: 'Restore draft' })).not.toBeNull();
    expect(view.getByRole('button', { name: 'Discard draft' })).not.toBeNull();
  });

  it('keeps local draft save flashes out of the immersive surface', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(await view.findByRole('button', { name: 'Bold' }));
    await waitFor(() =>
      expect(view.getByText('Local draft saved 12:34')).not.toBeNull()
    );

    fireEvent.click(view.getByRole('button', { name: '进入沉浸写作' }));
    expect(view.queryByText('Local draft saved 12:34')).toBeNull();
    expect(view.getByText('自动保存已开启')).not.toBeNull();

    fireEvent.click(view.getByRole('button', { name: 'Bold' }));
    await waitFor(() =>
      expect(props.localDraftStorage.write).toHaveBeenCalledTimes(2)
    );
    expect(view.queryByText('Local draft saved 12:34')).toBeNull();
  });

  it('keeps local draft failures visible in the immersive surface', async () => {
    const props = fixture();
    vi.mocked(props.localDraftStorage.write).mockReturnValue({
      code: 'local-draft-write-failed',
      status: 'failed'
    });
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: 'Bold' }));

    await waitFor(() =>
      expect(view.getByRole('alert').textContent).toBe(
        props.localDrafts.strings.saveFailed
      )
    );
  });

  it('does not clear an existing local draft failure when entering immersive mode', async () => {
    const props = fixture();
    vi.mocked(props.localDraftStorage.write).mockReturnValue({
      code: 'local-draft-write-failed',
      status: 'failed'
    });
    const view = render(<EditorRoot {...props} />);

    fireEvent.click(await view.findByRole('button', { name: 'Bold' }));
    await waitFor(() =>
      expect(view.getByRole('alert').textContent).toBe(
        props.localDrafts.strings.saveFailed
      )
    );

    fireEvent.click(view.getByRole('button', { name: '进入沉浸写作' }));
    expect(view.getByRole('alert').textContent).toBe(
      props.localDrafts.strings.saveFailed
    );
  });

  it('schedules local drafts from the document owner without depending on native bridge events', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);

    await waitFor(() =>
      expect(view.getByRole('button', { name: 'Bold' })).not.toBeNull()
    );
    vi.spyOn(props.submissionField, 'dispatchEvent').mockReturnValue(true);
    fireEvent.click(view.getByRole('button', { name: 'Bold' }));

    await waitFor(
      () =>
        expect(props.localDraftStorage.write).toHaveBeenCalledWith(
          '**selected**'
        ),
      { timeout: 1_000 }
    );
  });

  it('copies the stable Preview through the React WeChat session', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);

    await waitFor(() => {
      expect(
        view.container.querySelector('[data-easymde-preview-html-sink="1"]')
      ).not.toBeNull();
    });
    fireEvent.click(view.getByRole('button', { name: 'Copy to WeChat' }));

    await waitFor(() =>
      expect(props.wechatClipboard.copy).toHaveBeenCalledTimes(1)
    );
    expect(
      view
        .getByRole('button', { name: 'Copy to WeChat' })
        .querySelectorAll('.easymde-wechat-glyph path')
    ).toHaveLength(3);
    expect(props.wechatClipboard.copy).toHaveBeenCalledWith(
      view.container.querySelector('[data-easymde-preview-html-sink="1"]'),
      expect.objectContaining({
        pngConversionEnabled: false,
        postId: props.imageUpload.postId,
        maxBytes: props.imageUpload.maxBytes
      })
    );
    expect(view.getByText('Copied')).not.toBeNull();
    expect(props.executeExternalCommand).not.toHaveBeenCalledWith(
      'copywechat',
      expect.anything()
    );
  });

  it('passes PNG export through the protected image upload owner', async () => {
    const props = fixture();
    const rasterizationPort = {
      rasterize: vi.fn()
    };
    const view = render(
      <EditorRoot
        {...props}
        wechatExport={{ ...props.wechatExport, pngConversionEnabled: true }}
        wechatVisualRasterizationPort={rasterizationPort}
      />
    );

    await waitFor(() =>
      expect(
        view.container.querySelector('[data-easymde-preview-html-sink="1"]')
      ).not.toBeNull()
    );
    fireEvent.click(view.getByRole('button', { name: 'Copy to WeChat' }));
    await waitFor(() =>
      expect(props.wechatClipboard.copy).toHaveBeenCalledOnce()
    );

    const options = vi.mocked(props.wechatClipboard.copy).mock.calls[0]?.[1];
    expect(options?.pngConversionEnabled).toBe(true);
    expect(options?.postId).toBe(props.imageUpload.postId);
    expect(options?.maxBytes).toBe(props.imageUpload.maxBytes);
    expect(options?.visualRasterizationPort).toBe(rasterizationPort);
    expect(options?.imageUploadPort).toBeDefined();

    const rawUpload = vi.mocked(props.imageUploadPort.upload);
    const uploadResult = await options?.imageUploadPort?.upload({
      altText: '',
      file: new File(['png'], 'wechat.png', { type: 'image/png' }),
      postId: props.imageUpload.postId,
      signal: new AbortController().signal
    });
    expect(uploadResult?.status).toBe('uploaded');
    expect(rawUpload).toHaveBeenCalledOnce();
    view.unmount();
  });

  it('re-prepares the WeChat payload after a browser resize', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);
    const prepare = props.wechatClipboard.prepare;
    if (!prepare) throw new Error('wechat preparation is unavailable');
    const preparation = vi.mocked(prepare);

    await waitFor(() => expect(preparation).toHaveBeenCalled());
    const callsBeforeResize = preparation.mock.calls.length;
    act(() => props.triggerResize());

    await waitFor(() =>
      expect(preparation.mock.calls.length).toBeGreaterThan(callsBeforeResize)
    );
    view.unmount();
  });

  it('re-prepares the WeChat payload after preview media or font layout changes', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);
    const prepare = props.wechatClipboard.prepare;
    if (!prepare) throw new Error('wechat preparation is unavailable');
    const preparation = vi.mocked(prepare);

    await waitFor(() => expect(preparation).toHaveBeenCalled());
    const callsBeforeLayoutChange = preparation.mock.calls.length;
    act(() => props.triggerPreviewLayout());

    await waitFor(() =>
      expect(preparation.mock.calls.length).toBeGreaterThan(
        callsBeforeLayoutChange
      )
    );
    view.unmount();
  });

  it('re-prepares the WeChat payload after immersive layout mode changes', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);
    const prepare = props.wechatClipboard.prepare;
    if (!prepare) throw new Error('wechat preparation is unavailable');
    const preparation = vi.mocked(prepare);

    await waitFor(() => expect(preparation).toHaveBeenCalled());
    const callsBeforeImmersive = preparation.mock.calls.length;
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    await waitFor(() =>
      expect(preparation.mock.calls.length).toBeGreaterThan(
        callsBeforeImmersive
      )
    );

    const callsBeforePreview = preparation.mock.calls.length;
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    await waitFor(() =>
      expect(preparation.mock.calls.length).toBeGreaterThan(callsBeforePreview)
    );
    view.unmount();
  });

  it('rebinds WeChat layout observation when the immersive visual Preview mounts', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);
    await waitFor(() =>
      expect(props.getPreviewLayoutObservationCount()).toBeGreaterThan(0)
    );
    const observationsBeforeVisualPreview =
      props.getPreviewLayoutObservationCount();

    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
    fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));

    await waitFor(() =>
      expect(props.getPreviewLayoutObservationCount()).toBeGreaterThan(
        observationsBeforeVisualPreview
      )
    );
    view.unmount();
  });

  it('prepares WeChat after an immersive article theme change only once Preview is ready', async () => {
    const pendingPreview = deferred<PreviewResponse>();
    const props = fixture();
    let pendingPreviewRequest: PreviewRequest | null = null;
    const view = render(<EditorRoot {...props} />);
    const prepare = props.wechatClipboard.prepare;
    if (!prepare) throw new Error('wechat preparation is unavailable');
    const preparation = vi.mocked(prepare);

    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
    fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
    await view.findByRole('textbox', { name: '可视化文章编辑器' });
    const callsBeforeThemeChange = preparation.mock.calls.length;

    // Keep the refreshed Preview unresolved until explicitly completed. The
    // old ordinary DOM must not be prepared while this request is pending.
    vi.mocked(props.previewPort.render).mockImplementation((request) => {
      pendingPreviewRequest = request;
      return pendingPreview.promise;
    });
    fireEvent.click(view.getByRole('button', { name: '主题' }));
    fireEvent.click(view.getByRole('button', { name: 'Article theme' }));
    fireEvent.click(view.getByRole('option', { name: 'Newsprint' }));

    await act(async () => {
      await Promise.resolve();
    });
    expect(preparation.mock.calls.length).toBe(callsBeforeThemeChange);
    await act(async () => {
      if (!pendingPreviewRequest)
        throw new Error('missing theme preview request');
      pendingPreview.resolve(
        createPreviewResponse(
          pendingPreviewRequest,
          '<p>Theme Preview</p>' as SafePreviewHtml,
          {}
        )
      );
    });
    await waitFor(() =>
      expect(preparation.mock.calls.length).toBeGreaterThan(
        callsBeforeThemeChange
      )
    );
    expect(preparation.mock.calls.at(-1)?.[0]).toBe(
      view.container.querySelector('[data-easymde-preview-html-sink]')
    );
    view.unmount();
  });

  it('prepares WeChat after an immersive Custom CSS save only once Preview is ready', async () => {
    const pendingPreview = deferred<PreviewResponse>();
    const props = fixture();
    let pendingPreviewRequest: PreviewRequest | null = null;
    const savedSnapshot = {
      customCss: [
        {
          articleThemeName: 'Writer Article',
          codeThemeName: 'Writer Code',
          css: '.note { color: navy; }',
          id: 'writer-css',
          scopedCss: '.easymde-rendered-content .note { color: navy; }'
        }
      ],
      state: {
        codeTheme: 'atom-one-dark',
        customCssId: 'writer-css',
        markdownTheme: 'custom'
      }
    } as const;
    const appearancePort = {
      ...props.appearancePort,
      saveCustomCss: vi.fn().mockResolvedValue({
        snapshot: savedSnapshot,
        status: 'saved' as const
      })
    };
    const view = render(
      <EditorRoot {...props} appearancePort={appearancePort} />
    );
    const prepare = props.wechatClipboard.prepare;
    if (!prepare) throw new Error('wechat preparation is unavailable');
    const preparation = vi.mocked(prepare);

    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
    fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
    const callsBeforeSave = preparation.mock.calls.length;

    vi.mocked(props.previewPort.render).mockImplementation((request) => {
      pendingPreviewRequest = request;
      return pendingPreview.promise;
    });
    fireEvent.click(view.getByRole('button', { name: '主题' }));
    fireEvent.click(view.getByRole('button', { name: 'Custom CSS theme' }));
    fireEvent.change(
      view.getByRole('textbox', {
        name: 'Article theme name'
      }),
      {
        target: { value: 'Writer Article' }
      }
    );
    fireEvent.click(view.getByRole('button', { name: /Custom CSS code/ }));
    fireEvent.change(view.getByRole('textbox', { name: 'Custom CSS code' }), {
      target: { value: '.note { color: navy; }' }
    });
    fireEvent.click(view.getByRole('button', { name: 'Apply theme' }));

    await waitFor(() =>
      expect(appearancePort.saveCustomCss).toHaveBeenCalled()
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(preparation.mock.calls.length).toBe(callsBeforeSave);
    await act(async () => {
      if (!pendingPreviewRequest)
        throw new Error('missing custom CSS preview request');
      pendingPreview.resolve(
        createPreviewResponse(
          pendingPreviewRequest,
          '<p>Custom CSS Preview</p>' as SafePreviewHtml,
          {}
        )
      );
    });
    await waitFor(() =>
      expect(preparation.mock.calls.length).toBeGreaterThan(callsBeforeSave)
    );
    expect(preparation.mock.calls.at(-1)?.[0]).toBe(
      view.container.querySelector('[data-easymde-preview-html-sink]')
    );
    view.unmount();
  });

  it('does not report background WeChat preparation as a copy failure', async () => {
    const props = fixture();
    const prepare = props.wechatClipboard.prepare;
    if (!prepare) throw new Error('wechat preparation is unavailable');
    vi.mocked(prepare).mockRejectedValue(new Error('theme image unavailable'));
    const view = render(<EditorRoot {...props} />);

    await waitFor(() => expect(prepare).toHaveBeenCalled());
    expect(props.onFailure).not.toHaveBeenCalledWith(
      'wechat-theme-image-prepare-failed'
    );
    view.unmount();
  });

  it('does not prepare WeChat in the background when export is disabled', async () => {
    const props = fixture();
    const prepare = props.wechatClipboard.prepare;
    if (!prepare) throw new Error('wechat preparation is unavailable');
    const view = render(
      <EditorRoot
        {...props}
        wechatExport={{ ...props.wechatExport, enabled: false }}
      />
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(prepare).not.toHaveBeenCalled();
    expect(props.getPreviewLayoutObservationCount()).toBe(0);
    view.unmount();
  });

  it('binds synchronized scrolling to the preview canvas and disposes it with the Root', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);

    await waitFor(() =>
      expect(props.scrollSyncBinding.activate).toHaveBeenCalledTimes(1)
    );
    expect(props.scrollSyncPort.prepareBinding).toHaveBeenCalledWith({
      preview: view.container.querySelector(
        '.easymde-immersive-preview-canvas'
      ),
      source: view.container.querySelector('.cm-scroller')
    });

    view.unmount();
    expect(props.scrollSyncBinding.activate).toHaveBeenCalledTimes(1);
    expect(props.scrollSyncBinding.dispose).toHaveBeenCalledTimes(1);
  });

  it('disposes pending appearance work with the Root', () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);

    view.unmount();

    expect(props.appearancePort.dispose).toHaveBeenCalledTimes(1);
  });

  it('rebinds a single canvas scroll owner across ordinary, split and preview modes', async () => {
    const props = fixture();
    const view = render(<EditorRoot {...props} />);

    await waitFor(() =>
      expect(props.scrollSyncBinding.activate).toHaveBeenCalledTimes(1)
    );
    fireEvent.click(view.getByRole('button', { name: '进入沉浸写作' }));
    await waitFor(() =>
      expect(props.scrollSyncBinding.activate).toHaveBeenCalledTimes(2)
    );
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    await waitFor(() =>
      expect(props.scrollSyncBinding.activate).toHaveBeenCalledTimes(3)
    );

    expect(props.scrollSyncPort.prepareBinding).toHaveBeenCalledTimes(3);
    for (const [options] of vi.mocked(props.scrollSyncPort.prepareBinding).mock
      .calls) {
      expect(options.preview).toBe(
        view.container.querySelector('.easymde-immersive-preview-canvas')
      );
    }
    expect(props.scrollSyncBinding.dispose).toHaveBeenCalledTimes(2);

    view.unmount();
    expect(props.scrollSyncBinding.dispose).toHaveBeenCalledTimes(3);
  });
});
