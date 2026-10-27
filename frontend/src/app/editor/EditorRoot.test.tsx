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
import * as observedVisualOwner from '../../features/immersive-editor/ui/ImmersiveVisualEditor';
import type { GeneratedContentExportSession } from '../../features/generated-content-export/generated-content-export-session';
import * as generatedImageTarget from '../../features/generated-content-export/generated-image-target';
import * as imageScaleContract from '../../features/image-scale/image-scale-contract';
import * as observedSourceAdapter from '../../features/document-source/adapters/code-mirror-document-session';
import type { CodeMirrorDocumentSession, DocumentHistoryState, DocumentSelection } from '../../features/document-source/adapters/code-mirror-document-session';
import {
  createEditorMarkdownBlockIndex as observedBlockIndex
} from '../../features/editor-context-menu/editor-markdown-block-index';
import {
  findEditorCodeContentTarget as observedCodeContentTarget
} from '../../features/editor-context-menu/editor-code-content-target';
import type { EditorContextMenuSurfaceSnapshot, EditorContextMenuTargetLease } from '../../features/editor-context-menu/EditorContextMenuFeature';
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

/**
 * A demand/session request carries `<revision>:<markdown.length>`. The menu's
 * code-content query mints its own `editor-code-content:<seq>:...` signature and
 * is a DIFFERENT, legitimate render kind, so request accounting for a gesture's
 * demand refresh must exclude it explicitly rather than assume one render.
 */
function isCodeContentQuery(request: PreviewRequest): boolean {
  return request.signature.startsWith('editor-code-content:');
}

/** The gesture-relevant renders: everything except code-content queries. */
function demandRenders(
  render: ReturnType<typeof vi.fn>
): PreviewRequest[] {
  return render.mock.calls
    .map((call) => call[0] as PreviewRequest)
    .filter((request) => !isCodeContentQuery(request));
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

  it.each(['readOnly', 'disabled'] as const)(
    'fails a Source Paste whose field became %s during the Clipboard read',
    async (flag) => {
      // The action gate ran while the field was editable. The awaited Clipboard
      // read is the window: the authoritative native field changes after the
      // enabled action started. The mutation itself must re-check, fail exactly
      // once, and write neither the canonical document nor history.
      const props = fixture();
      props.submissionField.value = 'Before after';
      props.submissionField.defaultValue = 'Before after';
      props.submissionField.setSelectionRange(7, 7);
      const realCreateDocumentSession =
        observedSourceAdapter.createCodeMirrorDocumentSession;
      const documentOwnerRef: {
        current: ReturnType<typeof realCreateDocumentSession> | null;
      } = { current: null };
      vi.spyOn(observedSourceAdapter, 'createCodeMirrorDocumentSession')
        .mockImplementation((options) => {
          const owner = realCreateDocumentSession(options);
          documentOwnerRef.current = owner;
          return owner;
        });
      const read = props.editorClipboardPort?.read;
      if (!read) throw new Error('clipboard-read-port-missing');
      vi.mocked(read).mockImplementation(async () => {
        if ('readOnly' === flag) props.submissionField.readOnly = true;
        else props.submissionField.disabled = true;
        return { status: 'available', text: 'PASTED' };
      });
      const view = render(<EditorRoot {...props} />);
      try {
        const source = await waitFor(() => {
          const element = view.container.querySelector<HTMLElement>('.cm-content');
          if (!element) throw new Error('source-surface-missing');
          return element;
        });
        const owner = documentOwnerRef.current;
        if (!owner) throw new Error('source-document-owner-missing');
        const beforeSource = owner.getValue();
        const beforeSelection = owner.getSelection();
        const beforeHistory = owner.getHistoryState();
        const beforeRevision = owner.getRevision?.();
        layoutContextMenuSurface(source);
        fireEvent.contextMenu(source, { clientX: 20, clientY: 24 });
        fireEvent.click(
          await within(document.body).findByRole('menuitem', { name: /^Paste$/ })
        );
        await waitFor(() =>
          expect(props.onFailure).toHaveBeenCalledWith(
            'editor-context-menu-surface-read-only'
          )
        );
        expect(view.getByRole('alert').textContent).toBe(
          contextMenuStrings.statusActionFailed
        );
        // Only the selected authoritative flag changed and is still set.
        expect(props.submissionField.readOnly).toBe('readOnly' === flag);
        expect(props.submissionField.disabled).toBe('disabled' === flag);
        expect(owner.getValue()).toBe(beforeSource);
        expect(props.submissionField.value).toBe('Before after');
        expect(props.submissionField.value).not.toContain('PASTED');
        expect(owner.getSelection()).toEqual(beforeSelection);
        expect(owner.getHistoryState()).toEqual(beforeHistory);
        expect(owner.getRevision?.()).toBe(beforeRevision);
        // One stable owning error, not a duplicate or a generic code.
        expect(
          vi.mocked(props.onFailure).mock.calls.filter((call) =>
            call[0].startsWith('editor-context-menu-')
          )
        ).toEqual([['editor-context-menu-surface-read-only']]);

        // Restoring the exact original flag defers no insertion.
        props.submissionField.readOnly = false;
        props.submissionField.disabled = false;
        await act(async () => {
          await Promise.resolve();
          await Promise.resolve();
        });
        expect(owner.getValue()).toBe('Before after');
        expect(owner.getSelection()).toEqual(beforeSelection);
        expect(owner.getHistoryState()).toEqual(beforeHistory);
      } finally {
        props.submissionField.readOnly = false;
        props.submissionField.disabled = false;
        view.unmount();
      }
    }
  );

  it.each(['readOnly', 'disabled'] as const)(
    'fails a Source Cut whose field became %s during the Clipboard write',
    async (flag) => {
      // The Clipboard write may truthfully complete: the external write is not
      // the canonical Cut. The source deletion is the rejected half and must
      // leave the document, revision, history, and native selection untouched.
      const props = fixture();
      const initial = 'Before selected after';
      props.submissionField.value = initial;
      props.submissionField.defaultValue = initial;
      props.submissionField.setSelectionRange(7, 15);
      const realCreateDocumentSession =
        observedSourceAdapter.createCodeMirrorDocumentSession;
      const documentOwnerRef: {
        current: ReturnType<typeof realCreateDocumentSession> | null;
      } = { current: null };
      vi.spyOn(observedSourceAdapter, 'createCodeMirrorDocumentSession')
        .mockImplementation((options) => {
          const owner = realCreateDocumentSession(options);
          documentOwnerRef.current = owner;
          return owner;
        });
      const write = props.editorClipboardPort?.write;
      if (!write) throw new Error('clipboard-write-port-missing');
      vi.mocked(write).mockImplementation(async () => {
        if ('readOnly' === flag) props.submissionField.readOnly = true;
        else props.submissionField.disabled = true;
        return { status: 'written' };
      });
      const view = render(<EditorRoot {...props} />);
      try {
        const source = await waitFor(() => {
          const element = view.container.querySelector<HTMLElement>('.cm-content');
          if (!element) throw new Error('source-surface-missing');
          return element;
        });
        const owner = documentOwnerRef.current;
        if (!owner) throw new Error('source-document-owner-missing');
        const beforeSelection = owner.getSelection();
        const beforeHistory = owner.getHistoryState();
        const beforeRevision = owner.getRevision?.();
        layoutContextMenuSurface(source);
        fireEvent.contextMenu(source, { clientX: 20, clientY: 24 });
        fireEvent.click(
          await within(document.body).findByRole('menuitem', { name: /^Cut$/ })
        );
        await waitFor(() =>
          expect(props.onFailure).toHaveBeenCalledWith(
            'editor-context-menu-surface-read-only'
          )
        );
        // The visible failure is the same one the action gate reports.
        expect(view.getByRole('alert').textContent).toBe(
          contextMenuStrings.statusActionFailed
        );
        // The Clipboard write itself really happened; the deletion did not.
        expect(write).toHaveBeenCalledWith(
          'selected',
          expect.objectContaining({ signal: expect.any(AbortSignal) })
        );
        // Only the selected authoritative flag changed and is still set.
        expect(props.submissionField.readOnly).toBe('readOnly' === flag);
        expect(props.submissionField.disabled).toBe('disabled' === flag);
        expect(owner.getValue()).toBe(initial);
        expect(props.submissionField.value).toBe(initial);
        expect(owner.getSelection()).toEqual(beforeSelection);
        expect(owner.getHistoryState()).toEqual(beforeHistory);
        expect(owner.getRevision?.()).toBe(beforeRevision);
        expect([
          props.submissionField.selectionStart,
          props.submissionField.selectionEnd
        ]).toEqual([7, 15]);
        expect(
          vi.mocked(props.onFailure).mock.calls.filter((call) =>
            call[0].startsWith('editor-context-menu-')
          )
        ).toEqual([['editor-context-menu-surface-read-only']]);

        props.submissionField.readOnly = false;
        props.submissionField.disabled = false;
        await act(async () => {
          await Promise.resolve();
          await Promise.resolve();
        });
        expect(owner.getValue()).toBe(initial);
        expect(owner.getHistoryState()).toEqual(beforeHistory);
      } finally {
        props.submissionField.readOnly = false;
        props.submissionField.disabled = false;
        view.unmount();
      }
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

  it('opens context menu after Full Visual local text commit without Preview request via pointer and Shift+F10', async () => {
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
    const renderCallsBefore = vi.mocked(props.previewPort.render).mock.calls.length;

    // Dispatch local text input on the Full visual surface
    const paragraphText = visual.querySelector('p')?.firstChild;
    if (!(paragraphText instanceof Text)) throw new Error('visual-text-missing');
    visual.dispatchEvent(
      new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        data: '!',
        inputType: 'insertText'
      })
    );
    paragraphText.insertData(paragraphText.length, '!');
    const caret = document.createRange();
    caret.setStart(paragraphText, paragraphText.length);
    caret.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(caret);
    visual.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        data: '!',
        inputType: 'insertText'
      })
    );
    await act(async () => {
      await Promise.resolve();
    });
    await waitFor(() => expect(props.submissionField.value).toBe('Rendered!'));

    // Assert ordinary local text input does not trigger formal Preview while in Visual editing
    expect(vi.mocked(props.previewPort.render).mock.calls.length).toBe(renderCallsBefore);

    // Pointer context-menu demand succeeds exactly once
    layoutContextMenuSurface(visual);
    fireEvent.contextMenu(visual, { clientX: 24, clientY: 30 });
    const pointerMenu = await within(document.body).findByRole('menu');
    expect(pointerMenu).toBeTruthy();
    expect(within(document.body).getByRole('menuitem', { name: 'Copy' })).toBeTruthy();
    fireEvent.keyDown(pointerMenu, { key: 'Escape' });
    await waitFor(() => expect(within(document.body).queryByRole('menu')).toBeNull());

    // Shift+F10 keyboard context-menu demand succeeds exactly once
    fireEvent.keyDown(visual, { key: 'F10', shiftKey: true });
    const keyboardMenu = await within(document.body).findByRole('menu');
    expect(keyboardMenu).toBeTruthy();
    expect(within(document.body).getByRole('menuitem', { name: 'Copy' })).toBeTruthy();
    fireEvent.keyDown(keyboardMenu, { key: 'Escape' });
    await waitFor(() => expect(within(document.body).queryByRole('menu')).toBeNull());
    // While a genuine formal preview transfer is in flight, context-menu readiness remains pending
    const held = deferred<PreviewResponse>();
    vi.mocked(props.previewPort.render).mockImplementationOnce(() => held.promise);
    fireEvent.paste(visual, {
      clipboardData: {
        getData: (type: string) => type === 'text/plain' ? 'More' : '',
        types: ['text/plain']
      }
    });
    await act(async () => {
      await Promise.resolve();
    });

    // While the formal preview transfer is in flight, context-menu gesture stays pending (does not open)
    fireEvent.contextMenu(visual, { clientX: 24, clientY: 30 });
    expect(within(document.body).queryByRole('menu')).toBeNull();

    // Settle the held preview to allow the transfer to complete
    const [lastRequest] = vi.mocked(props.previewPort.render).mock.lastCall ?? [];
    if (lastRequest) {
      held.resolve(createPreviewResponse(lastRequest, '<p>Rendered!More</p>' as SafePreviewHtml, {}));
      await act(async () => {
        await held.promise;
      });
    }

    expect(props.onFailure).not.toHaveBeenCalled();
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

  it('opens the generic menu for a deliberate mixed text and image range over the pointed image', async () => {
    const props = fixture();
    const sourceMarkdown =
      'Before ![alt](https://example.test/original.png) after';
    props.submissionField.value = sourceMarkdown;
    props.submissionField.defaultValue = sourceMarkdown;
    props.submissionField.setSelectionRange(0, 0);
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
    const paragraph = visual.querySelector('p');
    const before = paragraph?.firstChild;
    const after = paragraph?.lastChild;
    const image = visual.querySelector('img');
    if (
      !(paragraph instanceof HTMLElement)
      || !(before instanceof Text)
      || !(after instanceof Text)
      || !(image instanceof HTMLImageElement)
    ) {
      throw new Error('visual-mixed-image-context-fixture-missing');
    }
    layoutContextMenuSurface(visual);
    // Native selection begins in the focused editable surface; focusing only
    // after installing a Range can collapse it to the prior contenteditable caret.
    visual.focus();
    expect(document.activeElement).toBe(visual);
    // A genuine mixed range covers text on both sides of the image, so no
    // single image source range contains it. The pointer is still on the image,
    // and the demanded outcome is the generic text menu with the extent kept.
    const range = document.createRange();
    range.setStart(before, 0);
    range.setEnd(after, after.length);
    const nativeSelection = window.getSelection();
    nativeSelection?.removeAllRanges();
    nativeSelection?.addRange(range);

    fireEvent.contextMenu(image, { clientX: 24, clientY: 30 });
    const menu = await within(document.body).findByRole('menu');
    expect(
      within(menu).queryByRole('menuitem', { name: 'Delete image' })
    ).toBeNull();
    expect(
      within(menu).queryByRole('menuitem', { name: 'Image scale' })
    ).toBeNull();
    expect(props.onFailure).not.toHaveBeenCalledWith(
      'editor-context-menu-image-stale'
    );
    expect(props.onFailure).not.toHaveBeenCalled();
    const keptSelection = window.getSelection();
    expect(keptSelection?.isCollapsed).toBe(false);
    expect(keptSelection?.anchorNode).toBe(before);
    expect(keptSelection?.anchorOffset).toBe(0);
    expect(keptSelection?.focusNode).toBe(after);
    expect(keptSelection?.focusOffset).toBe(after.length);
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() =>
      expect(within(document.body).queryByRole('menu')).toBeNull()
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

  it('keeps the Full visual owner unlocked after menu code deletion typing Undo Redo Undo', async () => {
    const props = fixture();
    const fenceMarkdown = 'Above\n\n```js\nconst value = 1;\n```';
    const codeStart = fenceMarkdown.indexOf('```js');
    const remainderMarkdown = 'Above\n\n';
    const typedMarkdown = 'AboveZZ\n\n';
    props.submissionField.value = fenceMarkdown;
    props.submissionField.defaultValue = fenceMarkdown;
    props.submissionField.setSelectionRange(0, 0);
    // The formal renderer's fence markup carries no fence metadata; this owner
    // restores it from the source, so the accepted mapping must not depend on
    // the markup arriving with it.
    const fenceHtml =
      '<p data-easymde-visual-block-id="b0">Above</p>'
      + '<pre data-easymde-visual-block-id="b1"><code>const value = 1;\n</code></pre>';
    const fenceEditMap = () => ({
      blocks: [
        { editable: true, endLine: 1, id: 'b0', startLine: 0 },
        { editable: true, endLine: 5, id: 'b1', startLine: 2 }
      ],
      coordinate: 'line' as const,
      version: 1 as const
    });
    const simpleEditMap = () => ({
      blocks: [{ editable: true, endLine: 1, id: 'b0', startLine: 0 }],
      coordinate: 'line' as const,
      version: 1 as const
    });
    const scopedFenceMarkdown = fenceMarkdown.slice(codeStart);
    const codeResponse = (request: PreviewRequest): PreviewResponse => {
      const scoped = request.markdown === scopedFenceMarkdown;
      if (!scoped && request.markdown !== fenceMarkdown) {
        throw new Error(`unexpected-code-preview-request:${request.markdown}`);
      }
      const source = request.markdown;
      const contentStart = source.indexOf('const');
      if (contentStart < 0) {
        throw new Error('code-content-source-missing');
      }
      const base = createCodeContentPreviewResponse(
        request,
        source,
        contentStart,
        'const value = 1;\n'
      );
      const editMap = scoped
        ? {
            blocks: [{ editable: true, endLine: 3, id: 'b0', startLine: 0 }],
            coordinate: 'line' as const,
            signature: request.signature,
            version: 1 as const
          }
        : { ...fenceEditMap(), signature: request.signature };
      const codeProjection = {
        coordinate: 'line' as const,
        entries: [{
          endLine: scoped ? 3 : 5,
          fenceOffset: 0,
          info: 'js',
          kind: 'fenced' as const,
          rows: [{
            contentLine: 0,
            literalFrom: 0,
            literalLeadingSpaces: 0,
            prefixEnd: 0,
            prefixTabColumns: 0,
            sourceLine: scoped ? 1 : 3
          }],
          startLine: scoped ? 0 : 2,
          status: 'available' as const
        }],
        offsetUnit: 'utf16' as const,
        signature: request.signature,
        status: 'available' as const,
        version: 1 as const
      };
      return {
        ...base,
        codeProjection,
        editMap,
        html: (scoped
          ? '<pre><code>const value = 1;\n</code></pre>'
          : fenceHtml) as SafePreviewHtml
      };
    };
    const tailResponse = (request: PreviewRequest): PreviewResponse => {
      const tailHtml = request.markdown === typedMarkdown
        ? '<p data-easymde-visual-block-id="b0">AboveZZ</p>'
        : '<p data-easymde-visual-block-id="b0">Above</p>';
      return {
        ...createPreviewResponse(request, tailHtml as SafePreviewHtml, {}),
        editMap: { ...simpleEditMap(), signature: request.signature }
      };
    };
    vi.mocked(props.previewPort.render).mockImplementation((request) => {
      if (request.markdown === remainderMarkdown || request.markdown === typedMarkdown) {
        return Promise.resolve(tailResponse(request));
      }
      if (request.markdown === fenceMarkdown || request.markdown === scopedFenceMarkdown) {
        return Promise.resolve(codeResponse(request));
      }
      return Promise.reject(new Error(`unexpected-preview-request:${request.markdown}`));
    });
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
      throw new Error('full-history-menu-code-missing');
    }
    // A real drag inside the code body, not a collapse on the PRE element.
    const range = document.createRange();
    range.setStart(codeText, 0);
    range.setEnd(codeText, 5);
    const nativeSelection = window.getSelection();
    nativeSelection?.removeAllRanges();
    nativeSelection?.addRange(range);

    layoutContextMenuSurface(visual);
    fireEvent.contextMenu(codeBlock, { clientX: 24, clientY: 30 });
    const menu = await within(document.body).findByRole('menu');
    const trigger = within(menu).getByRole('menuitem', { name: 'Code block' });
    fireEvent.pointerDown(trigger, { button: 0 });
    fireEvent.click(trigger);
    const submenu = await within(document.body).findByRole('menu', {
      name: 'Code block'
    });
    const deleteItem = within(submenu).getByRole('menuitem', {
      name: 'Delete code block'
    });
    fireEvent.pointerDown(deleteItem, { button: 0 });
    fireEvent.click(deleteItem);
    await waitFor(() => expect(props.submissionField.value).toBe(remainderMarkdown));
    expect(props.submissionField.value.slice(0, codeStart)).toBe('Above\n\n');
    expect(
      vi.mocked(props.onFailure).mock.calls.map(([code]) => code),
      JSON.stringify({ editable: visual.getAttribute('contenteditable') })
    ).toEqual([]);
    expect(visual.getAttribute('contenteditable')).toBe('true');

    const failureCodes = (): ReadonlyArray<string> =>
      vi.mocked(props.onFailure).mock.calls.map(([code]) => code);
    const surfaceText = (): Text => {
      const text = visual.querySelector('p')?.firstChild;
      if (!(text instanceof Text)) {
        throw new Error('full-history-menu-survived-text-missing');
      }
      return text;
    };
    for (const character of ['Z', 'Z']) {
      const target = surfaceText();
      visual.dispatchEvent(
        new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          data: character,
          inputType: 'insertText'
        })
      );
      target.insertData(target.length, character);
      const caret = document.createRange();
      caret.setStart(target, target.length);
      caret.collapse(true);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(caret);
      visual.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          data: character,
          inputType: 'insertText'
        })
      );
      await act(async () => {
        await Promise.resolve();
      });
    }
    await waitFor(() => expect(props.submissionField.value).toBe(typedMarkdown));

    const press = (shift: boolean): void => {
      fireEvent.keyDown(visual, {
        cancelable: true,
        ctrlKey: true,
        key: 'z',
        shiftKey: shift
      });
    };
    // Undo the typing, undo the removal, redo it and undo it again, all
    // through the real Root/Preview/Sink pair.
    press(false);
    await waitFor(() => expect(props.submissionField.value).toBe(remainderMarkdown));
    press(false);
    await waitFor(() => expect(props.submissionField.value).toBe(fenceMarkdown));
    expect(failureCodes(), JSON.stringify({ step: 'undo-removal' })).toEqual([]);
    expect(visual.getAttribute('contenteditable')).toBe('true');
    press(true);
    await waitFor(() => expect(props.submissionField.value).toBe(remainderMarkdown));
    expect(failureCodes(), JSON.stringify({ step: 'redo-removal' })).toEqual([]);
    expect(visual.getAttribute('contenteditable')).toBe('true');
    press(false);
    await waitFor(() => expect(props.submissionField.value).toBe(fenceMarkdown));
    expect(failureCodes(), JSON.stringify({ step: 'undo-again' })).toEqual([]);
    expect(view.queryByRole('textbox', { name: '可视化文章编辑器' })).not.toBeNull();
    expect(visual.getAttribute('contenteditable')).toBe('true');
    view.unmount();
  });

  it.each([1, 2])('completes the rich 160-block Full menu Paste transaction at local caret %i', async (localCaret) => {
    const props = fixture();
    const pasted = '```bash\necho hi\n```';
    const targetIndex = 13;
    const protectedIndex = targetIndex + 1 + 40;
    const beforeSourceBlocks = [
      '# Markdown 全量能力测试文档',
      '> 用于测试标题、排版、表格、代码、数学公式、Mermaid 图表、HTML、脚注、任务列表等 Markdown 渲染能力。',
      '---',
      '## 1. 标题层级',
      '# 一级标题 Heading 1',
      '## 二级标题 Heading 2',
      '### 三级标题 Heading 3',
      '#### 四级标题 Heading 4',
      '##### 五级标题 Heading 5',
      '###### 六级标题 Heading 6',
      '## 超长中英文标题用于验证狭窄预览容器中的正常换行、完整可读性以及主题前后缀装饰仍然保持可见 This intentionally long bilingual heading verifies wrapping and complete readability without clipping in narrow preview panes',
      '---',
      '## 2. 文本样式'
    ];
    const beforeHtmlBlocks = [
      '<h1>Markdown 全量能力测试文档</h1>',
      '<blockquote><p>用于测试标题、排版、表格、代码、数学公式、Mermaid 图表、HTML、脚注、任务列表等 Markdown 渲染能力。</p></blockquote>',
      '<hr>',
      '<h2>1. 标题层级</h2>',
      '<h1>一级标题 Heading 1</h1>',
      '<h2>二级标题 Heading 2</h2>',
      '<h3>三级标题 Heading 3</h3>',
      '<h4>四级标题 Heading 4</h4>',
      '<h5>五级标题 Heading 5</h5>',
      '<h6>六级标题 Heading 6</h6>',
      '<h2>超长中英文标题用于验证狭窄预览容器中的正常换行、完整可读性以及主题前后缀装饰仍然保持可见 This intentionally long bilingual heading verifies wrapping and complete readability without clipping in narrow preview panes</h2>',
      '<hr>',
      '<h2>2. 文本样式</h2>'
    ];
    const visiblePrefix = '普通文本、';
    const suffixMarkup = '**粗体文本**、*斜体文本*、***粗斜体文本***。';
    const targetSource = `${visiblePrefix}${suffixMarkup}`;
    const suffixSourceBlocks = Array.from(
      { length: 146 },
      (_, index) => `第${index}段*斜体*后续正文，普通文本。`
    );
    const suffixHtmlBlocks = suffixSourceBlocks.map(
      (_, index) => `<p>第${index}段<i>斜体</i>后续正文，普通文本。</p>`
    );
    const sourceBlocks = [...beforeSourceBlocks, targetSource, ...suffixSourceBlocks];
    expect(sourceBlocks).toHaveLength(160);
    const source = sourceBlocks.join('\n\n');
    const targetStart = source.indexOf(targetSource);
    if (targetStart < 0) throw new Error('root-r5-rich-target-source-missing');
    const insertionStart = targetStart + localCaret;
    const nextSource = source.slice(0, insertionStart)
      + pasted
      + source.slice(insertionStart);
    const insertionEnd = insertionStart + pasted.length;
    const typedSource = nextSource.slice(0, insertionEnd)
      + 'Z'
      + nextSource.slice(insertionEnd);
    const escapeHtml = (value: string): string => value
      .replace(/&/gu, '&amp;')
      .replace(/</gu, '&lt;')
      .replace(/>/gu, '&gt;');
    const targetHtml = (block: string): string => {
      const inline = block.slice(0, -suffixMarkup.length);
      if (!block.endsWith(suffixMarkup)) {
        throw new Error('root-r5-rich-target-markup-missing');
      }
      return '<p data-easymde-visual-block-id="b13">'
        + `${escapeHtml(inline)}<strong>粗体文本</strong>、`
        + '<em>斜体文本</em>、<strong><em>粗斜体文本</em></strong>。</p>';
    };
    const responseFor = (request: PreviewRequest): PreviewResponse => {
      const blocks = request.markdown.split('\n\n');
      if (blocks.length !== sourceBlocks.length) {
        throw new Error(`root-r5-rich-block-count:${blocks.length}`);
      }
      let nextLine = 0;
      const editBlocks = blocks.map((block, index) => {
        const startLine = nextLine;
        const endLine = startLine + block.split('\n').length;
        nextLine = endLine + (index + 1 < blocks.length ? 1 : 0);
        return {
          editable: index !== protectedIndex,
          endLine,
          id: `b${index}`,
          startLine
        };
      });
      if (nextLine !== request.markdown.split('\n').length) {
        throw new Error('root-r5-rich-line-map-bounds');
      }
      const html = blocks.map((block, index) => {
        const marker = `data-easymde-visual-block-id="b${index}"`;
        if (index === targetIndex) return targetHtml(block);
        const protectedAttribute = index === protectedIndex
          ? ' contenteditable="false"'
          : '';
        const content = index < beforeHtmlBlocks.length
          ? beforeHtmlBlocks[index]
          : suffixHtmlBlocks[index - targetIndex - 1];
        if (!content) throw new Error('root-r5-rich-html-block-missing');
        return `<${content.slice(1, content.indexOf('>'))} ${marker}${protectedAttribute}>`
          + content.slice(content.indexOf('>') + 1);
      }).join('');
      return {
        editMap: {
          blocks: editBlocks,
          coordinate: 'line',
          signature: request.signature,
          version: 1
        },
        features: {},
        html: html as SafePreviewHtml
      };
    };
    props.submissionField.value = source;
    props.submissionField.defaultValue = source;
    props.submissionField.setSelectionRange(0, 0);
    if (!props.editorClipboardPort) throw new Error('root-r5-clipboard-port-missing');
    // The paste's formal Preview response is held so canonical publication and
    // accepted visual completion are independently observable.
    const pasteResponse = deferred<PreviewResponse>();
    let pasteDeferredPending = true;
    // The real CodeMirror document owner, not a mock history: every value,
    // revision and history assertion below reads the owner Root actually uses.
    const realCreateDocumentSession =
      observedSourceAdapter.createCodeMirrorDocumentSession;
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
      request.markdown === nextSource && pasteDeferredPending
        ? pasteResponse.promise
        : Promise.resolve(responseFor(request))
    );
    vi.mocked(props.editorClipboardPort.read).mockResolvedValue({
      status: 'available',
      text: pasted
    });
    const view = render(
      <EditorRoot
        {...props}
        editorBlockIndexPort={sourceLinkBlockIndexPort()}
      />
    );
    let visual: HTMLElement;
    let acceptedSink: HTMLElement | null = null;
    let acceptedSignature: string | null = null;
    const acceptedRequestFor = (value: string): PreviewRequest => {
      const request = [...vi.mocked(props.previewPort.render).mock.calls]
        .reverse()
        .map(([candidate]) => candidate)
        .find((candidate) => candidate.markdown === value);
      if (!request) throw new Error('root-r5-rich-accepted-request-missing');
      return request;
    };
    const waitAccepted = async (value: string): Promise<void> => {
      const expectedTarget = value.split('\n\n')[targetIndex];
      if (undefined === expectedTarget) throw new Error('root-r5-target-block-missing');
      await waitFor(() => {
        expect(props.submissionField.value).toBe(value);
        if (value === typedSource) {
          expect(acceptedSignature).not.toBeNull();
          expect(visual.easymdePreviewSignature).toBe(acceptedSignature);
        } else {
          const request = acceptedRequestFor(value);
          acceptedSignature = request.signature;
          expect(visual.easymdePreviewSignature).toBe(request.signature);
        }
        expect(visual.getAttribute('data-easymde-preview-phase')).toBe('ready');
        expect(visual.getAttribute('contenteditable')).toBe('true');
        expect(visual.querySelector<HTMLElement>(
          `[data-easymde-visual-block-id="b${targetIndex}"]`
        )?.textContent).toBe(expectedTarget.replace(suffixMarkup, '粗体文本、斜体文本、粗斜体文本。'));
        if (acceptedSink) expect(
          view.container.querySelector('[data-easymde-preview-html-sink="1"]')
        ).toBe(acceptedSink);
      });
    };
    try {
      fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
      fireEvent.click(view.getByRole('button', { name: '预览' }));
      await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
      layoutPreviewSurface(view.container);
      fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
      visual = await view.findByRole('textbox', { name: '可视化文章编辑器' });
      acceptedSink = view.container.querySelector<HTMLElement>(
        '[data-easymde-preview-html-sink="1"]'
      );
      if (!acceptedSink) throw new Error('root-r5-rich-sink-missing');
      await waitAccepted(source);
      const target = visual.querySelector<HTMLElement>(
        `[data-easymde-visual-block-id="b${targetIndex}"]`
      );
      const targetText = target?.firstChild;
      if (!(target instanceof HTMLElement) || !(targetText instanceof Text)) {
        throw new Error('root-r5-rich-target-missing');
      }
      const initialRange = document.createRange();
      initialRange.setStart(targetText, localCaret);
      initialRange.collapse(true);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(initialRange);
      fireEvent.pointerDown(target, { button: 2, clientX: 20, clientY: 20 });
      fireEvent.mouseDown(target, { button: 2, clientX: 20, clientY: 20 });
      fireEvent.contextMenu(target, { clientX: 20, clientY: 20 });
      const menu = await within(document.body).findByRole('menu');
      const pasteItem = within(menu).getAllByRole('menuitem', { name: /paste/i })[0];
      if (!pasteItem) throw new Error('root-r5-rich-paste-item-missing');
      fireEvent.pointerDown(pasteItem, { button: 0 });
      fireEvent.click(pasteItem);
      const owner = documentOwnerRef.current;
      if (!owner) throw new Error('root-r5-rich-document-owner-missing');
      // Source publication and accepted visual completion are separate owners:
      // the canonical document must already carry the paste while the formal
      // Preview response is still outstanding.
      await waitFor(() => expect(owner.getValue()).toBe(nextSource));
      expect(props.submissionField.value).toBe(nextSource);
      expect(pasteDeferredPending).toBe(true);
      expect(visual.getAttribute('data-easymde-preview-phase')).not.toBe('ready');
      pasteDeferredPending = false;
      const pasteRequest = acceptedRequestFor(nextSource);
      pasteResponse.resolve(responseFor(pasteRequest));
      await waitAccepted(nextSource);
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      const acceptedTarget = visual.querySelector<HTMLElement>(
        `[data-easymde-visual-block-id="b${targetIndex}"]`
      );
      const acceptedSelection = window.getSelection();
      const acceptedNode = acceptedSelection?.anchorNode;
      if (
        !(acceptedTarget instanceof HTMLElement)
        || !(acceptedNode instanceof Text)
        || !acceptedTarget.contains(acceptedNode)
        || acceptedSelection?.rangeCount !== 1
        || !acceptedSelection.isCollapsed
      ) {
        throw new Error('root-r5-rich-adopted-caret-missing');
      }
      if (!(acceptedNode instanceof Text)) throw new Error('root-r5-adopted-text-missing');
      if (!acceptedSelection) throw new Error('root-r5-adopted-selection-missing');
      const acceptedTargetSource = nextSource.split('\n\n')[targetIndex];
      if (undefined === acceptedTargetSource) throw new Error('root-r5-accepted-source-block-missing');
      expect(acceptedNode.textContent).toBe(
        acceptedTargetSource.slice(0, -suffixMarkup.length)
      );
      expect(acceptedSelection.anchorOffset).toBe(localCaret + pasted.length);
      expect(acceptedSelection.focusNode).toBe(acceptedNode);
      expect(acceptedSelection.focusOffset).toBe(localCaret + pasted.length);

      visual.focus();
      if (window.getSelection()?.anchorNode !== acceptedNode) {
        throw new Error('root-r5-rich-focus-lost-adopted-selection');
      }
      const adoptedOffset = acceptedSelection.anchorOffset;
      const targetRange = document.createRange();
      targetRange.setStart(acceptedNode, adoptedOffset);
      targetRange.collapse(true);
      const beforeInput = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        data: 'Z',
        inputType: 'insertText'
      });
      Object.defineProperty(beforeInput, 'getTargetRanges', {
        configurable: true,
        value: () => [targetRange]
      });
      visual.dispatchEvent(beforeInput);
      expect(beforeInput.defaultPrevented).toBe(false);
      if (!acceptedNode.isConnected || acceptedSelection.anchorNode !== acceptedNode) {
        throw new Error('root-r5-rich-node-replaced-before-typing');
      }
      acceptedNode.insertData(adoptedOffset, 'Z');
      if (!acceptedNode.data.includes('Z')) {
        throw new Error('root-r5-rich-dom-insert-missing');
      }
      const afterTyping = document.createRange();
      afterTyping.setStart(acceptedNode, adoptedOffset + 1);
      afterTyping.collapse(true);
      acceptedSelection.removeAllRanges();
      acceptedSelection.addRange(afterTyping);
      visual.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        data: 'Z',
        inputType: 'insertText'
      }));
      await act(async () => {
        await Promise.resolve();
      });
      await waitAccepted(typedSource);

      // The typed character reached the real CodeMirror document, not only the
      // textarea mirror, and it is one history step on top of the paste.
      expect(owner.getValue()).toBe(typedSource);
      expect(owner.getHistoryState().undoDepth).toBeGreaterThan(0);
      const typedHistory = owner.getHistoryState();

      const pressUndo = (shiftKey = false): void => {
        fireEvent.keyDown(visual, {
          cancelable: true,
          ctrlKey: true,
          key: 'z',
          shiftKey
        });
      };
      pressUndo();
      await waitAccepted(nextSource);
      expect(owner.getValue()).toBe(nextSource);
      expect(owner.getHistoryState().undoDepth).toBe(typedHistory.undoDepth - 1);
      pressUndo();
      await waitAccepted(source);
      expect(owner.getValue()).toBe(source);
      expect(owner.getHistoryState().undoDepth).toBe(typedHistory.undoDepth - 2);
      pressUndo(true);
      await waitAccepted(nextSource);
      expect(owner.getValue()).toBe(nextSource);
      pressUndo();
      await waitAccepted(source);
      expect(owner.getValue()).toBe(source);
      expect(owner.getHistoryState()).toEqual({
        redoDepth: typedHistory.redoDepth + 2,
        undoDepth: typedHistory.undoDepth - 2
      });
      expect(props.onFailure).not.toHaveBeenCalled();
      expect(visual.getAttribute('contenteditable')).toBe('true');
    } finally {
      view.unmount();
    }
  });

  it.each([
    { direction: 'forward' as const, marker: '---' },
    { direction: 'forward' as const, marker: '- - -' },
    { direction: 'forward' as const, marker: '_ _ _' },
    { direction: 'forward' as const, marker: '* * *' },
    { direction: 'backward' as const, marker: '_ _ _' }
  ])('deletes a Full HR through pointerdown mousedown contextmenu and restores it with Undo for $marker $direction', async ({ direction, marker }) => {
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
    const initial = `before\n\n${marker}\nafter`;
    const expected = 'before\n\n\nafter';
    props.submissionField.value = initial;
    props.submissionField.defaultValue = initial;
    props.submissionField.setSelectionRange(0, 0);
    vi.mocked(props.previewPort.render).mockImplementation((request) => {
      const deleted = request.markdown === expected;
      return Promise.resolve({
        editMap: {
          blocks: deleted
            ? [
                { editable: true, endLine: 1, id: 'b0', startLine: 0 },
                { editable: true, endLine: 4, id: 'b2', startLine: 3 }
              ]
            : [
                { editable: true, endLine: 1, id: 'b0', startLine: 0 },
                { editable: true, endLine: 3, id: 'b1', startLine: 2 },
                { editable: true, endLine: 4, id: 'b2', startLine: 3 }
              ],
          coordinate: 'line',
          signature: request.signature,
          version: 1
        },
        features: {},
        html: (deleted
          ? '<p data-easymde-visual-block-id="b0">before</p>'
            + '<p data-easymde-visual-block-id="b2">after</p>'
          : '<p data-easymde-visual-block-id="b0">before</p>'
            + '<hr data-easymde-visual-block-id="b1">'
            + '<p data-easymde-visual-block-id="b2">after</p>') as SafePreviewHtml
      });
    });
    const view = render(
      <EditorRoot {...props} editorBlockIndexPort={sourceLinkBlockIndexPort()} />
    );
    try {
      fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
      fireEvent.click(view.getByRole('button', { name: '预览' }));
      await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
      layoutPreviewSurface(view.container);
      fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
      const visual = await view.findByRole('textbox', { name: '可视化文章编辑器' });
      const thematicBreak = visual.querySelector('hr');
      if (!(thematicBreak instanceof HTMLHRElement)) {
        throw new Error('root-r14-hr-missing');
      }
      if ('backward' === direction) {
        // A backward native selection of the HR token: the pointer path keeps
        // that direction for the canonical selection the Undo restores.
        const tokenIndex = Array.from(visual.childNodes).indexOf(thematicBreak);
        const nativeRange = document.createRange();
        nativeRange.selectNode(thematicBreak);
        const nativeSelection = window.getSelection();
        nativeSelection?.removeAllRanges();
        nativeSelection?.addRange(nativeRange);
        nativeSelection?.setBaseAndExtent(
          visual,
          tokenIndex + 1,
          visual,
          tokenIndex
        );
      }
      const owner = documentOwnerRef.current;
      if (!owner) throw new Error('root-r14-document-owner-missing');
      const openingValue = owner.getValue();
      const openingRevision = owner.getRevision?.();
      const openingHistory = owner.getHistoryState();
      const openingHtml = visual.innerHTML;
      const canonicalInput = vi.fn();
      props.submissionField.addEventListener('input', canonicalInput);
      fireEvent.pointerDown(thematicBreak, { button: 2, clientX: 20, clientY: 20 });
      fireEvent.mouseDown(thematicBreak, { button: 2, clientX: 20, clientY: 20 });
      fireEvent.contextMenu(thematicBreak, { clientX: 20, clientY: 20 });
      const menus = await within(document.body).findAllByRole('menu');
      expect(menus).toHaveLength(1);
      const menu = menus[0];
      if (!menu) throw new Error('root-r14-menu-missing');
      expect(owner.getValue()).toBe(openingValue);
      expect(owner.getRevision?.()).toBe(openingRevision);
      expect(owner.getHistoryState()).toEqual(openingHistory);
      expect(visual.innerHTML).toBe(openingHtml);
      expect(canonicalInput).not.toHaveBeenCalled();
      props.submissionField.removeEventListener('input', canonicalInput);
      const deleteItem = within(menu).getByRole('menuitem', {
        name: 'Delete horizontal rule'
      });
      expect(deleteItem.getAttribute('aria-disabled')).toBe('false');
      fireEvent.pointerDown(deleteItem, { button: 0 });
      fireEvent.click(deleteItem);
      await waitFor(() => expect(props.submissionField.value).toBe(expected));
      expect(owner.getValue()).toBe(expected);
      expect(owner.getHistoryState().undoDepth).toBe(openingHistory.undoDepth + 1);
      expect(visual.querySelector('hr')).toBeNull();
      expect(props.onFailure).not.toHaveBeenCalled();
      fireEvent.keyDown(visual, { cancelable: true, ctrlKey: true, key: 'z' });
      await waitFor(() => expect(props.submissionField.value).toBe(initial));
      expect(owner.getValue()).toBe(initial);
      expect(owner.getHistoryState()).toEqual({
        redoDepth: openingHistory.redoDepth + 1,
        undoDepth: openingHistory.undoDepth
      });
      expect(visual.getAttribute('contenteditable')).toBe('true');
      const restoredHr = visual.querySelector('hr');
      if (!(restoredHr instanceof HTMLHRElement)) {
        throw new Error('root-r14-restored-hr-missing');
      }
      const restoredIndex = Array.from(visual.childNodes).indexOf(restoredHr);
      const restoredSelection = window.getSelection();
      expect(restoredSelection?.anchorNode).toBe(visual);
      expect(restoredSelection?.focusNode).toBe(visual);
      expect(restoredSelection?.anchorOffset).toBe(
        'backward' === direction ? restoredIndex + 1 : restoredIndex
      );
      expect(restoredSelection?.focusOffset).toBe(
        'backward' === direction ? restoredIndex : restoredIndex + 1
      );
      expect(props.onFailure).not.toHaveBeenCalled();
    } finally {
      view.unmount();
    }
  });

  it.each([
    { name: 'Full Shift+F10 before HR', windowed: false, key: 'F10', shiftKey: true, side: 'before' as const },
    { name: 'Full ContextMenu after HR', windowed: false, key: 'ContextMenu', shiftKey: false, side: 'after' as const },
    { name: 'Windowed Shift+F10 before HR', windowed: true, key: 'F10', shiftKey: true, side: 'before' as const },
    { name: 'Windowed ContextMenu after HR', windowed: true, key: 'ContextMenu', shiftKey: false, side: 'after' as const }
  ])('opens exactly one HR menu via real Feature keyboard event for $name with displaced canonical EOF', async ({
    windowed, key, shiftKey, side
  }) => {
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
    const suffixBlocks = windowed
      ? Array.from({ length: 158 }, (_, index) => `suffix paragraph ${index}`)
      : [];
    const sourceBlocks = ['before', '---', 'after', ...suffixBlocks];
    const initial = sourceBlocks.join('\n\n');
    const hrStart = initial.indexOf('---');
    const hrEnd = hrStart + 3;
    props.submissionField.value = initial;
    props.submissionField.defaultValue = initial;
    props.submissionField.setSelectionRange(0, 0);

    const renderedHtml = [
      '<p data-easymde-visual-block-id="b0">before</p>',
      '<hr data-easymde-visual-block-id="b1">',
      '<p data-easymde-visual-block-id="b2">after</p>',
      ...suffixBlocks.map((text, index) => `<p data-easymde-visual-block-id="b${index + 3}">${text}</p>`)
    ].join('');

    const editMapBlocks = sourceBlocks.map((_, index) => ({
      editable: true,
      endLine: index * 2 + 1,
      id: `b${index}`,
      startLine: index * 2
    }));

    let previewCalls = 0;
    vi.mocked(props.previewPort.render).mockImplementation((request) => {
      previewCalls += 1;
      return Promise.resolve({
        editMap: {
          blocks: editMapBlocks,
          coordinate: 'line',
          signature: request.signature,
          version: 1
        },
        features: {},
        html: renderedHtml as SafePreviewHtml
      });
    });

    const view = render(
      <EditorRoot {...props} editorBlockIndexPort={sourceLinkBlockIndexPort()} />
    );
    try {
      fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
      fireEvent.click(view.getByRole('button', { name: '预览' }));
      await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
      layoutPreviewSurface(view.container);
      fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
      const visual = await view.findByRole('textbox', { name: '可视化文章编辑器' });
      const thematicBreak = visual.querySelector('hr');
      if (!(thematicBreak instanceof HTMLHRElement)) {
        throw new Error('feature-hr-test-hr-missing');
      }

      // Assert spacer presence: spacer present for Windowed, absent for Full
      const hasSpacer = visual.querySelector('[data-easymde-preview-window-spacer]') !== null;
      if (windowed) {
        expect(hasSpacer).toBe(true);
      } else {
        expect(hasSpacer).toBe(false);
      }

      const owner = documentOwnerRef.current;
      if (!owner) throw new Error('feature-hr-test-owner-missing');

      // Displace canonical selection to EOF (matching independent tester diagnosis)
      const eof = initial.length;
      owner.applyTextChange({
        selection: { direction: 'none', start: eof, end: eof },
        value: initial
      });
      expect(owner.getSelection().start).toBe(eof);
      expect(owner.getSelection().start).toBeGreaterThan(hrEnd);

      // Focus visual and collapse native selection before or after HR
      visual.focus();
      const hrIndex = Array.from(visual.childNodes).indexOf(thematicBreak);
      const targetOffset = side === 'before' ? hrIndex : hrIndex + 1;
      const nativeSelection = window.getSelection();
      nativeSelection?.removeAllRanges();
      const range = document.createRange();
      range.setStart(visual, targetOffset);
      range.collapse(true);
      nativeSelection?.addRange(range);
      expect(nativeSelection?.anchorNode).toBe(visual);
      expect(nativeSelection?.anchorOffset).toBe(targetOffset);

      const beforeKey = {
        history: owner.getHistoryState(),
        previewCalls,
        revision: owner.getRevision?.(),
        value: owner.getValue(),
        visualHtml: visual.innerHTML
      };

      // Dispatch real key event to visual surface
      fireEvent.keyDown(visual, { key, shiftKey });

      // The Feature prepares the certified parent gap synchronously. jsdom moves
      // the DOM Selection onto the focused menu item when the menu takes focus,
      // so the native owner's full collapsed shape is asserted here, before that
      // unrelated focus transfer, and the canonical projection below stays.
      const native = window.getSelection();
      expect(native?.rangeCount).toBe(1);
      expect(native?.isCollapsed).toBe(true);
      expect(native?.anchorNode).toBe(visual);
      expect(native?.anchorOffset).toBe(targetOffset);
      expect(native?.focusNode).toBe(visual);
      expect(native?.focusOffset).toBe(targetOffset);

      // Exactly one menu opened
      const menus = await within(document.body).findAllByRole('menu');
      expect(menus).toHaveLength(1);
      const menu = menus[0];
      if (!menu) throw new Error('feature-hr-test-menu-missing');

      // Enabled "Delete horizontal rule" item present
      const deleteItem = within(menu).getByRole('menuitem', {
        name: 'Delete horizontal rule'
      });
      expect(deleteItem.getAttribute('aria-disabled')).toBe('false');

      // Canonical selection collapsed to expected token side
      const expectedCanonical = side === 'before' ? hrStart : hrEnd;
      expect(owner.getSelection()).toEqual({
        direction: 'none',
        start: expectedCanonical,
        end: expectedCanonical
      });

      // Native selection was asserted above, before menu focus moved it.

      // Value, submissionField, revision, history, Preview calls, DOM unchanged
      expect(owner.getValue()).toBe(beforeKey.value);
      expect(props.submissionField.value).toBe(beforeKey.value);
      expect(owner.getRevision?.()).toBe(beforeKey.revision);
      expect(owner.getHistoryState()).toEqual(beforeKey.history);
      expect(previewCalls).toBe(beforeKey.previewCalls);
      expect(visual.innerHTML).toBe(beforeKey.visualHtml);
      expect(props.onFailure).not.toHaveBeenCalled();
    } finally {
      view.unmount();
    }
  });

  it.each([
    { name: 'Full noncollapsed canonical adjacent HR', windowed: false },
    { name: 'Windowed noncollapsed canonical adjacent HR', windowed: true }
  ])('refuses keyboard menu on ambiguous adjacent HR when canonical is noncollapsed for $name', async ({
    windowed
  }) => {
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
    const suffixBlocks = windowed
      ? Array.from({ length: 160 }, (_, index) => `suffix paragraph ${index}`)
      : [];
    const sourceBlocks = ['---', '---', ...suffixBlocks];
    const initial = sourceBlocks.join('\n\n');
    props.submissionField.value = initial;
    props.submissionField.defaultValue = initial;
    props.submissionField.setSelectionRange(0, 0);

    const renderedHtml = [
      '<hr data-easymde-visual-block-id="b0">',
      '<hr data-easymde-visual-block-id="b1">',
      ...suffixBlocks.map((text, index) => `<p data-easymde-visual-block-id="b${index + 2}">${text}</p>`)
    ].join('');

    const editMapBlocks = sourceBlocks.map((_, index) => ({
      editable: true,
      endLine: index * 2 + 1,
      id: `b${index}`,
      startLine: index * 2
    }));

    let previewCalls = 0;
    vi.mocked(props.previewPort.render).mockImplementation((request) => {
      previewCalls += 1;
      return Promise.resolve({
        editMap: {
          blocks: editMapBlocks,
          coordinate: 'line',
          signature: request.signature,
          version: 1
        },
        features: {},
        html: renderedHtml as SafePreviewHtml
      });
    });

    const view = render(
      <EditorRoot {...props} editorBlockIndexPort={sourceLinkBlockIndexPort()} />
    );
    try {
      fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
      fireEvent.click(view.getByRole('button', { name: '预览' }));
      await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
      layoutPreviewSurface(view.container);
      fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
      const visual = await view.findByRole('textbox', { name: '可视化文章编辑器' });

      // Assert spacer presence: spacer present for Windowed, absent for Full
      const hasSpacer = visual.querySelector('[data-easymde-preview-window-spacer]') !== null;
      if (windowed) {
        expect(hasSpacer).toBe(true);
      } else {
        expect(hasSpacer).toBe(false);
      }
      const owner = documentOwnerRef.current;
      if (!owner) throw new Error('feature-negative-test-owner-missing');

      // Set stale non-collapsed canonical range {start: 3, end: 8, direction: 'forward'}
      // (start happens to equal firstEnd=3, but non-collapsed means it must NOT disambiguate)
      owner.applyTextChange({
        selection: { direction: 'forward', start: 3, end: 8 },
        value: initial
      });
      expect(owner.getSelection()).toEqual({
        direction: 'forward',
        start: 3,
        end: 8
      });

      // Native selection collapsed at surface offset 1 (between the two HRs)
      visual.focus();
      const nativeSelection = window.getSelection();
      nativeSelection?.removeAllRanges();
      const range = document.createRange();
      range.setStart(visual, 1);
      range.collapse(true);
      nativeSelection?.addRange(range);
      expect(nativeSelection?.anchorNode).toBe(visual);
      expect(nativeSelection?.anchorOffset).toBe(1);

      const beforeKey = {
        history: owner.getHistoryState(),
        previewCalls,
        revision: owner.getRevision?.(),
        selection: owner.getSelection(),
        value: owner.getValue(),
        visualHtml: visual.innerHTML
      };

      // Dispatch Shift+F10
      fireEvent.keyDown(visual, { key: 'F10', shiftKey: true });

      // No menu should open on ambiguous adjacent HRs
      const menus = within(document.body).queryAllByRole('menu');
      expect(menus).toHaveLength(0);

      // Value, submissionField, revision, history, selection, Preview calls, DOM unchanged
      expect(owner.getValue()).toBe(beforeKey.value);
      expect(props.submissionField.value).toBe(beforeKey.value);
      expect(owner.getRevision?.()).toBe(beforeKey.revision);
      expect(owner.getHistoryState()).toEqual(beforeKey.history);
      expect(owner.getSelection()).toEqual(beforeKey.selection);
      expect(previewCalls).toBe(beforeKey.previewCalls);
      expect(visual.innerHTML).toBe(beforeKey.visualHtml);
      await waitFor(() =>
        expect(props.onFailure).toHaveBeenCalledWith(
          'editor-context-menu-selection-map-failed'
        )
      );
    } finally {
      view.unmount();
    }
  });

  it.each([
    { name: 'Full same-ID replacement HR', windowed: false },
    { name: 'Windowed same-ID replacement HR', windowed: true }
  ])('refuses keyboard menu and preserves state on replaced same-ID HR for $name', async ({
    windowed
  }) => {
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
    const suffixBlocks = windowed
      ? Array.from({ length: 160 }, (_, index) => `suffix paragraph ${index}`)
      : [];
    const sourceBlocks = ['before', '---', 'after', ...suffixBlocks];
    const initial = sourceBlocks.join('\n\n');
    props.submissionField.value = initial;
    props.submissionField.defaultValue = initial;
    props.submissionField.setSelectionRange(0, 0);

    const renderedHtml = [
      '<p data-easymde-visual-block-id="b0">before</p>',
      '<hr data-easymde-visual-block-id="b1">',
      '<p data-easymde-visual-block-id="b2">after</p>',
      ...suffixBlocks.map((text, index) => `<p data-easymde-visual-block-id="b${index + 3}">${text}</p>`)
    ].join('');

    const editMapBlocks = sourceBlocks.map((_, index) => ({
      editable: true,
      endLine: index * 2 + 1,
      id: `b${index}`,
      startLine: index * 2
    }));

    let previewCalls = 0;
    vi.mocked(props.previewPort.render).mockImplementation((request) => {
      previewCalls += 1;
      return Promise.resolve({
        editMap: {
          blocks: editMapBlocks,
          coordinate: 'line',
          signature: request.signature,
          version: 1
        },
        features: {},
        html: renderedHtml as SafePreviewHtml
      });
    });

    const view = render(
      <EditorRoot {...props} editorBlockIndexPort={sourceLinkBlockIndexPort()} />
    );
    try {
      fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
      fireEvent.click(view.getByRole('button', { name: '预览' }));
      await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
      layoutPreviewSurface(view.container);
      fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
      const visual = await view.findByRole('textbox', { name: '可视化文章编辑器' });

      const hasSpacer = visual.querySelector('[data-easymde-preview-window-spacer]') !== null;
      if (windowed) {
        expect(hasSpacer).toBe(true);
      } else {
        expect(hasSpacer).toBe(false);
      }
      const owner = documentOwnerRef.current;
      if (!owner) throw new Error('feature-replacement-negative-owner-missing');

      // Displace canonical selection to EOF
      const eof = initial.length;
      owner.applyTextChange({
        selection: { direction: 'none', start: eof, end: eof },
        value: initial
      });
      expect(owner.getSelection().start).toBe(eof);

      const thematicBreak = visual.querySelector('hr');
      if (!(thematicBreak instanceof HTMLHRElement)) {
        throw new Error('feature-replacement-negative-hr-missing');
      }

      const beforeKey = {
        history: owner.getHistoryState(),
        previewCalls,
        revision: owner.getRevision?.(),
        selection: owner.getSelection(),
        value: owner.getValue()
      };

      // Mutate: replace HR with a same-ID clone
      thematicBreak.replaceWith(thematicBreak.cloneNode(true));

      visual.focus();
      const hrIndex = Array.from(visual.childNodes).findIndex((node) => node instanceof HTMLHRElement);
      const nativeSelection = window.getSelection();
      nativeSelection?.removeAllRanges();
      const range = document.createRange();
      range.setStart(visual, hrIndex);
      range.collapse(true);
      nativeSelection?.addRange(range);

      fireEvent.keyDown(visual, { key: 'F10', shiftKey: true });

      // A replaced same-ID HR is a LEASE-LOST target: the Feature's replay path
      // retires it silently (EditorContextMenuFeature.tsx:1073-1096 classifies
      // lease-lost separately from every other rebuild failure), so the truthful
      // behaviour is no menu and NO user-facing failure - the user cannot act on
      // a target the owner can no longer authenticate. Every piece of state the
      // negative protects is still asserted unchanged below.
      await act(async () => {
        await Promise.resolve();
      });
      // Observed per variant: the Full owner retires the lease-lost target
      // silently, while the Windowed owner reports its own explicit
      // `editor-context-menu-target-unavailable` capture failure. Both are the
      // owner's own single report, and neither opens a menu or mutates state.
      const reported = vi
        .mocked(props.onFailure)
        .mock.calls.map((call) => String(call[0]));
      expect(
        reported.length <= 1
        && reported.every(
          (code) =>
            'editor-context-menu-target-unavailable' === code
        )
      ).toBe(true);
      const menus = within(document.body).queryAllByRole('menu');
      expect(menus).toHaveLength(0);

      expect(owner.getValue()).toBe(beforeKey.value);
      expect(props.submissionField.value).toBe(beforeKey.value);
      expect(owner.getRevision?.()).toBe(beforeKey.revision);
      expect(owner.getHistoryState()).toEqual(beforeKey.history);
      expect(owner.getSelection()).toEqual(beforeKey.selection);
      expect(previewCalls).toBe(beforeKey.previewCalls);
      const hrAfterMutation = visual.querySelector('hr');
      expect(hrAfterMutation).not.toBeNull();
      expect(hrAfterMutation).not.toBe(thematicBreak);
    } finally {
      view.unmount();
    }
  });

  it.each([
    { name: 'Full intact-DOM beforeinput canonical mismatch', windowed: false },
    { name: 'Windowed intact-DOM beforeinput canonical mismatch', windowed: true }
  ])('rejects beforeinput text insertion on intact accepted DOM when canonical caret is mismatched for $name', async ({
    windowed
  }) => {
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
    const suffixBlocks = windowed
      ? Array.from({ length: 160 }, (_, index) => `suffix paragraph ${index}`)
      : [];
    const sourceBlocks = ['before', '---', 'after', ...suffixBlocks];
    const initial = sourceBlocks.join('\n\n');
    props.submissionField.value = initial;
    props.submissionField.defaultValue = initial;
    props.submissionField.setSelectionRange(0, 0);

    const renderedHtml = [
      '<p data-easymde-visual-block-id="b0">before</p>',
      '<hr data-easymde-visual-block-id="b1">',
      '<p data-easymde-visual-block-id="b2">after</p>',
      ...suffixBlocks.map((text, index) => `<p data-easymde-visual-block-id="b${index + 3}">${text}</p>`)
    ].join('');

    const editMapBlocks = sourceBlocks.map((_, index) => ({
      editable: true,
      endLine: index * 2 + 1,
      id: `b${index}`,
      startLine: index * 2
    }));

    let previewCalls = 0;
    vi.mocked(props.previewPort.render).mockImplementation((request) => {
      previewCalls += 1;
      return Promise.resolve({
        editMap: {
          blocks: editMapBlocks,
          coordinate: 'line',
          signature: request.signature,
          version: 1
        },
        features: {},
        html: renderedHtml as SafePreviewHtml
      });
    });

    const view = render(
      <EditorRoot {...props} editorBlockIndexPort={sourceLinkBlockIndexPort()} />
    );
    try {
      fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
      fireEvent.click(view.getByRole('button', { name: '预览' }));
      await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
      layoutPreviewSurface(view.container);
      fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
      const visual = await view.findByRole('textbox', { name: '可视化文章编辑器' });

      const hasSpacer = visual.querySelector('[data-easymde-preview-window-spacer]') !== null;
      if (windowed) {
        expect(hasSpacer).toBe(true);
      } else {
        expect(hasSpacer).toBe(false);
      }
      const owner = documentOwnerRef.current;
      if (!owner) throw new Error('feature-intact-mismatch-owner-missing');

      // Canonical caret is displaced to EOF (mismatched with native gap)
      const eof = initial.length;
      owner.applyTextChange({
        selection: { direction: 'none', start: eof, end: eof },
        value: initial
      });
      expect(owner.getSelection().start).toBe(eof);

      // Native selection collapsed at surface root gap before HR on INTACT DOM
      visual.focus();
      const thematicBreak = visual.querySelector('hr');
      if (!(thematicBreak instanceof HTMLHRElement)) {
        throw new Error('feature-intact-mismatch-hr-missing');
      }
      const hrIndex = Array.from(visual.childNodes).indexOf(thematicBreak);
      const nativeSelection = window.getSelection();
      nativeSelection?.removeAllRanges();
      const range = document.createRange();
      range.setStart(visual, hrIndex);
      range.collapse(true);
      nativeSelection?.addRange(range);

      const beforeInput = {
        history: owner.getHistoryState(),
        previewCalls,
        revision: owner.getRevision?.(),
        selection: owner.getSelection(),
        value: owner.getValue(),
        visualHtml: visual.innerHTML
      };

      // Dispatch beforeinput text insertion on INTACT accepted DOM before any context preparation
      const inputEvent = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        data: 'X',
        inputType: 'insertText'
      });
      visual.dispatchEvent(inputEvent);

      // Event must be prevented and fail closed
      expect(inputEvent.defaultPrevented).toBe(true);
      expect(owner.getValue()).toBe(beforeInput.value);
      expect(props.submissionField.value).toBe(beforeInput.value);
      expect(owner.getRevision?.()).toBe(beforeInput.revision);
      expect(owner.getHistoryState()).toEqual(beforeInput.history);
      expect(owner.getSelection()).toEqual(beforeInput.selection);
      expect(previewCalls).toBe(beforeInput.previewCalls);
      expect(visual.innerHTML).toBe(beforeInput.visualHtml);
      expect(props.onFailure).toHaveBeenCalled();
    } finally {
      view.unmount();
    }
  });

  it('keeps the full surface menu usable on the next HR right after an HR deletion', async () => {
    const props = fixture();
    const initial = 'before\n\n---\n\nmid\n\n---\n\nafter';
    // Deleting the first HR removes only its three marker bytes.
    const hrStart = initial.indexOf('---');
    const expected = initial.slice(0, hrStart) + initial.slice(hrStart + 3);
    props.submissionField.value = initial;
    props.submissionField.defaultValue = initial;
    props.submissionField.setSelectionRange(0, 0);
    // Every blank-line separated block becomes one rendered element, and its
    // line span is measured from the actual source rather than assumed.
    const responseFor = (request: PreviewRequest): PreviewResponse => {
      const markdown = request.markdown;
      const blocks: Array<{
        editable: true;
        endLine: number;
        id: string;
        startLine: number;
      }> = [];
      const html: string[] = [];
      let offset = 0;
      while (offset <= markdown.length) {
        const separator = markdown.indexOf('\n\n', offset);
        const end = separator < 0 ? markdown.length : separator;
        const block = markdown.slice(offset, end);
        if (block.length > 0) {
          const id = `b${blocks.length}`;
          const startLine = markdown.slice(0, offset).split('\n').length - 1;
          blocks.push({
            editable: true,
            endLine: startLine + block.split('\n').length,
            id,
            startLine
          });
          const marker = ` data-easymde-visual-block-id="${id}"`;
          html.push(
            '---' === block ? `<hr${marker}>` : `<p${marker}>${block}</p>`
          );
        }
        if (separator < 0) break;
        offset = end + 2;
      }
      return {
        editMap: {
          blocks,
          coordinate: 'line',
          signature: request.signature,
          version: 1
        },
        features: {},
        html: html.join('') as SafePreviewHtml
      };
    };
    // The post-deletion response is held so the second gesture arrives while
    // that transfer is still outstanding, which is the browser's race window.
    const heldResponse = deferred<PreviewResponse>();
    let holdResponse = true;
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      request.markdown === expected && holdResponse
        ? heldResponse.promise
        : Promise.resolve(responseFor(request))
    );
    const view = render(
      <EditorRoot {...props} editorBlockIndexPort={sourceLinkBlockIndexPort()} />
    );
    // A real pointer gesture on the HR: the surface maps the pointed element
    // itself, exactly like the passing single-delete Full regression.
    const demandOn = (target: HTMLElement): void => {
      layoutContextMenuSurface(target);
      fireEvent.pointerDown(target, { button: 2, clientX: 20, clientY: 20 });
      fireEvent.mouseDown(target, { button: 2, clientX: 20, clientY: 20 });
      fireEvent.contextMenu(target, { clientX: 20, clientY: 20 });
    };
    try {
      fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
      fireEvent.click(view.getByRole('button', { name: '预览' }));
      await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
      layoutPreviewSurface(view.container);
      fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
      const visual = await view.findByRole('textbox', { name: '可视化文章编辑器' });
      await waitFor(() =>
        expect(visual.getAttribute('data-easymde-preview-phase')).toBe('ready')
      );
      const hrs = (): Element[] => Array.from(visual.querySelectorAll('hr'));
      expect(hrs()).toHaveLength(2);
      demandOn(hrs()[0] as HTMLElement);
      const menu = await within(document.body).findByRole('menu');
      expect(
        vi.mocked(props.onFailure).mock.calls,
        'failures after the first HR demand'
      ).toEqual([]);
      fireEvent.click(
        within(menu).getByRole('menuitem', { name: 'Delete horizontal rule' })
      );
      await waitFor(() => expect(props.submissionField.value).toBe(expected));
      expect(props.onFailure).not.toHaveBeenCalled();

      // The structural index for the deleted source is a separate readiness
      // input; wait for it, then assert the published status is the loading
      // window. In jsdom the owner's own transfer flag is also set here, so
      // this fixture exercises the transfer arm; the phase arm covers demands
      // that arrive while a render is outstanding without a transfer.
      await waitFor(() =>
        expect(visual.getAttribute('data-easymde-preview-phase')).toBe('loading')
      );
      // Immediately point at the remaining HR, without waiting for the
      // accepted Preview of the deletion to land. The surface still shows the
      // pre-deletion DOM here, so the second HR is the last one on screen.
      const remaining = hrs();
      expect(remaining.length).toBeGreaterThan(0);
      demandOn(remaining[remaining.length - 1] as HTMLElement);
      await act(async () => {
        await Promise.resolve();
      });
      holdResponse = false;
      heldResponse.resolve(responseFor(
        [...vi.mocked(props.previewPort.render).mock.calls]
          .map(([request]) => request)
          .find((request) => request.markdown === expected)
          ?? (() => { throw new Error('full-owner-held-request-missing'); })()
      ));
      await act(async () => {
        await heldResponse.promise;
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      });
      // Either a usable menu or a fail-closed rejection is acceptable, but the
      // gesture must never surface a selection-map failure.
      expect(
        vi.mocked(props.onFailure).mock.calls,
        'failures after the second HR demand'
      ).toEqual([]);
      expect(view.queryByRole('alert')).toBeNull();
      expect(visual.getAttribute('contenteditable')).toBe('true');
      expect(props.submissionField.value).toBe(expected);
      expect(view.queryByRole('textbox', { name: '可视化文章编辑器' })).not.toBeNull();
    } finally {
      view.unmount();
    }
  });

  it('keeps the pointed PRE usable after a native local edit commits without a render', async () => {
    // The availability invariant for the pointed-PRE workflow: a native local
    // edit commits to the canonical document without requesting a render, and
    // the very next PRE demand must still open the menu. It must never turn into
    // "no menu, explicit error", which is the defect the owner-level refresh
    // exists to prevent. The coordinate-move case that forces a re-authenticated
    // render is driven in `ImmersiveVisualEditor.test.tsx`, where a real burst
    // can be synthesised; this fixture proves the Root wiring keeps the gesture.
    const fence = String.fromCharCode(96).repeat(3);
    const initial = `Lead\n\n${fence}js\nalpha\n${fence}\n`;
    const props = fixture();
    props.submissionField.value = initial;
    props.submissionField.defaultValue = initial;
    props.submissionField.setSelectionRange(0, 0);
    const bodyOf = (markdown: string): string => {
      const match = /```[^\n]*\n([\s\S]*?)\n```/u.exec(markdown);
      return match?.[1] ?? '';
    };
    vi.mocked(props.previewPort.render).mockImplementation((request) => {
      const template = document.createElement('template');
      template.innerHTML =
        `<p>Lead</p><pre><code class="language-js">${bodyOf(request.markdown)}</code></pre>`;
      Array.from(template.content.children).forEach((element, index) => {
        element.setAttribute('data-easymde-visual-block-id', `b${index}`);
      });
      const lineCount = request.markdown.split('\n').length;
      return Promise.resolve({
        editMap: {
          blocks: [
            { editable: true, endLine: 1, id: 'b0', startLine: 0 },
            { editable: true, endLine: lineCount, id: 'b1', startLine: 2 }
          ],
          coordinate: 'line' as const,
          signature: request.signature,
          version: 1 as const
        },
        features: {},
        html: template.innerHTML as SafePreviewHtml
      });
    });
    const view = render(<EditorRoot {...props} />);
    try {
      fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
      fireEvent.click(view.getByRole('button', { name: '预览' }));
      await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
      layoutPreviewSurface(view.container);
      fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
      const visual = await view.findByRole('textbox', { name: '可视化文章编辑器' });
      await waitFor(() =>
        expect(visual.getAttribute('data-easymde-preview-phase')).toBe('ready')
      );
      const renderCalls = vi.mocked(props.previewPort.render).mock.calls.length;
      const body = visual.querySelector('pre > code')?.firstChild;
      if (!(body instanceof Text)) throw new Error('availability-code-body-missing');
      body.insertData(body.length, 'z');
      visual.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          data: 'z',
          inputType: 'insertText'
        })
      );
      await waitFor(() =>
        expect(props.submissionField.value).toBe(
          `Lead\n\n${fence}js\nalphaz\n${fence}\n`
        )
      );
      // The local edit stays inside the code body, so no render was requested.
      expect(vi.mocked(props.previewPort.render).mock.calls.length).toBe(
        renderCalls
      );
      // The pointed PRE still opens its menu, with no stale-map failure.
      const pre = visual.querySelector('pre');
      if (!(pre instanceof HTMLElement)) throw new Error('availability-pre-missing');
      layoutContextMenuSurface(pre);
      fireEvent.contextMenu(pre, { clientX: 20, clientY: 20 });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      await waitFor(() =>
        expect(within(document.body).queryAllByRole('menu').length).toBeGreaterThan(0)
      );
      expect(
        vi.mocked(props.onFailure).mock.calls.map((call) => call[0])
      ).not.toContain('visual-editor-canonical-change-map-stale');
      expect(
        vi.mocked(props.onFailure).mock.calls.map((call) => call[0])
      ).not.toContain('editor-context-menu-selection-map-failed');
    } finally {
      view.unmount();
    }
  });

  it('reports one terminal failure and makes no second request when the refresh render fails', async () => {
    // Main's ordering blocker: the failed render settles the pending state while
    // the old accepted HTML and revision are still installed. If readiness were
    // published before the terminal flags, the parked demand would wake on a
    // stale accepted source with no failure set and start a SECOND formal
    // request. Exactly one request, one terminal failure, and a closed demand.
    const fence = String.fromCharCode(96).repeat(3);
    const initial = `Lead\n\n${fence}js\nalpha\n${fence}\n`;
    const expectedCommitted = `Lead\n\n${fence}js\nalpha\nz\n${fence}\n`;
    const props = fixture();
    props.submissionField.value = initial;
    props.submissionField.defaultValue = initial;
    props.submissionField.setSelectionRange(0, 0);
    const responseFor = (request: PreviewRequest): PreviewResponse => {
      const lines = request.markdown.split('\n');
      const openIndex = lines.findIndex((line) =>
        new RegExp(`^${fence}[^${fence}]*$`, 'u').test(line)
      );
      const closeIndex = openIndex < 0
        ? -1
        : lines.findIndex((line, index) =>
            index > openIndex && line.startsWith(fence)
          );
      if (openIndex < 0 || closeIndex < 0) {
        throw new Error(`failed-refresh-source-without-fence:${request.markdown}`);
      }
      const body = lines.slice(openIndex + 1, closeIndex).join('\n');
      return {
        editMap: {
          blocks: [
            { editable: true, endLine: 1, id: 'b0', startLine: 0 },
            {
              editable: true,
              endLine: closeIndex + 1,
              id: 'b1',
              startLine: openIndex
            }
          ],
          coordinate: 'line' as const,
          signature: request.signature,
          version: 1 as const
        },
        features: {},
        html: (
          '<p data-easymde-visual-block-id="b0">Lead</p>'
          + `<pre data-easymde-visual-block-id="b1"><code class="language-js">${body}\n</code></pre>`
        ) as SafePreviewHtml
      };
    };
    const failingRefresh = deferred<PreviewResponse>();
    let failRefresh = false;
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      failRefresh && request.markdown === expectedCommitted
        ? failingRefresh.promise
        : Promise.resolve(responseFor(request))
    );
    const realCreateDocumentSession =
      observedSourceAdapter.createCodeMirrorDocumentSession;
    const documentOwnerRef: {
      current: ReturnType<typeof realCreateDocumentSession> | null;
    } = { current: null };
    vi.spyOn(observedSourceAdapter, 'createCodeMirrorDocumentSession')
      .mockImplementation((options) => {
        const owner = realCreateDocumentSession(options);
        documentOwnerRef.current = owner;
        return owner;
      });
    const view = render(<EditorRoot {...props} />);
    try {
      fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
      fireEvent.click(view.getByRole('button', { name: '预览' }));
      await waitFor(
        () => expect(props.previewPort.render).toHaveBeenCalled(),
        { timeout: 3000 }
      );
      layoutPreviewSurface(view.container);
      fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
      const visual = await view.findByRole('textbox', { name: '可视化文章编辑器' });
      await waitFor(() =>
        expect(visual.getAttribute('data-easymde-preview-phase')).toBe('ready')
      );
      const owner = documentOwnerRef.current;
      if (!owner) throw new Error('failed-refresh-owner-missing');
      const codeBody = visual.querySelector('pre > code')?.firstChild;
      if (!(codeBody instanceof Text)) {
        throw new Error('failed-refresh-code-body-missing');
      }
      visual.focus();
      const placeCaret = (offset: number) => {
        const range = document.createRange();
        range.setStart(codeBody, offset);
        range.collapse(true);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      };
      // The same native burst the positive case uses: a consumed line break,
      // then a typed character, so the committed source really gains a line.
      const offset = codeBody.data.length;
      placeCaret(offset);
      const lineBreak = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        data: null,
        inputType: 'insertLineBreak'
      });
      visual.dispatchEvent(lineBreak);
      if (!lineBreak.defaultPrevented) {
        codeBody.insertData(offset, '\n');
        placeCaret(offset + 1);
      }
      visual.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          data: null,
          inputType: 'insertLineBreak'
        })
      );
      const typedAt = codeBody.data.length;
      placeCaret(typedAt);
      const typed = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        data: 'z',
        inputType: 'insertText'
      });
      visual.dispatchEvent(typed);
      if (!typed.defaultPrevented) {
        codeBody.insertData(typedAt, 'z');
        placeCaret(typedAt + 1);
      }
      visual.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          data: 'z',
          inputType: 'insertText'
        })
      );
      await waitFor(() =>
        expect(props.submissionField.value).toBe(expectedCommitted)
      );
      const committed = props.submissionField.value;
      const failuresBefore = vi.mocked(props.onFailure).mock.calls.length;
      const requestsBeforeGesture = vi.mocked(props.previewPort.render).mock.calls.length;
      // The failed refresh must not change canonical history either: the typed
      // burst is the last documented entry, and the demand adds none.
      const historyBeforeGesture = owner.getHistoryState();
      const revisionBeforeGesture = owner.getRevision?.();

      failRefresh = true;
      const target = visual.querySelector('pre');
      if (!(target instanceof HTMLElement)) {
        throw new Error('failed-refresh-target-missing');
      }
      layoutContextMenuSurface(target);
      fireEvent.pointerDown(target, { button: 2, clientX: 20, clientY: 20 });
      fireEvent.contextMenu(target, { clientX: 20, clientY: 20 });

      // Exactly ONE request for the committed source while it is held.
      await waitFor(() =>
        expect(
          vi.mocked(props.previewPort.render).mock.calls.length
        ).toBe(requestsBeforeGesture + 1)
      );
      const demandRequests = vi
        .mocked(props.previewPort.render)
        .mock.calls.slice(requestsBeforeGesture);
      expect(demandRequests).toHaveLength(1);
      expect(demandRequests[0]?.[0].markdown).toBe(committed);
      expect(within(document.body).queryAllByRole('menu')).toHaveLength(0);

      // The render really fails.
      failingRefresh.reject(new Error('preview-render-unavailable'));
      await waitFor(
        () =>
          expect(props.onFailure).toHaveBeenCalledTimes(failuresBefore + 1),
        { timeout: 5000 }
      );
      expect(props.onFailure).toHaveBeenLastCalledWith(
        'visual-editor-native-preview-failed'
      );
      // Terminal: the owner left the editable surface, no menu opened, and no
      // second request was issued after the failure settled.
      await waitFor(() =>
        expect(
          view.queryByRole('textbox', { name: '可视化文章编辑器' })
        ).toBeNull()
      );
      const requestsAtFailure = vi.mocked(props.previewPort.render).mock.calls.length;
      expect(requestsAtFailure).toBe(requestsBeforeGesture + 1);
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(vi.mocked(props.previewPort.render).mock.calls.length).toBe(
        requestsAtFailure
      );
      expect(props.onFailure).toHaveBeenCalledTimes(failuresBefore + 1);
      expect(within(document.body).queryAllByRole('menu')).toHaveLength(0);
      // The user's own typed source is preserved, never rolled back, and the
      // failed refresh added neither a history entry nor a revision.
      expect(props.submissionField.value).toBe(committed);
      expect(owner.getHistoryState()).toEqual(historyBeforeGesture);
      expect(owner.getRevision?.()).toBe(revisionBeforeGesture);
    } finally {
      view.unmount();
    }
  });

  it('keeps one pointer demand alive through the refresh it requested and copies the whole fence', async () => {
    // Main's requirement: after one native code-body burst that moves a line,
    // ONE pointer demand must survive the re-authentication it triggers, bind
    // the freshly accepted DOM, and open ONE menu whose Copy reproduces the
    // whole current fence - not cancel so the user has to right-click again.
    const fence = String.fromCharCode(96).repeat(3);
    const initial = `Lead\n\n${fence}js\nalpha\n${fence}\n`;
    const expectedCommitted = `Lead\n\n${fence}js\nalpha\nz\n${fence}\n`;
    const props = fixture();
    props.submissionField.value = initial;
    props.submissionField.defaultValue = initial;
    props.submissionField.setSelectionRange(0, 0);
    // A response builder over the ACTUAL requested source: explicit source
    // lines and a real edit map over them, including the formal renderer's
    // terminal body LF inside the code element.
    const responseFor = (request: PreviewRequest): PreviewResponse => {
      const lines = request.markdown.split('\n');
      const openIndex = lines.findIndex((line) =>
        new RegExp(`^${fence}[^${fence}]*$`, 'u').test(line)
      );
      const closeIndex = openIndex < 0
        ? -1
        : lines.findIndex((line, index) =>
            index > openIndex && line.startsWith(fence)
          );
      if (openIndex < 0 || closeIndex < 0) {
        throw new Error(`single-demand-source-without-fence:${request.markdown}`);
      }
      const body = lines.slice(openIndex + 1, closeIndex).join('\n');
      const editableLines = closeIndex + 1;
      return {
        editMap: {
          blocks: [
            { editable: true, endLine: 1, id: 'b0', startLine: 0 },
            {
              editable: true,
              endLine: editableLines,
              id: 'b1',
              startLine: openIndex
            }
          ],
          coordinate: 'line' as const,
          signature: request.signature,
          version: 1 as const
        },
        features: {},
        html: (
          '<p data-easymde-visual-block-id="b0">Lead</p>'
          + `<pre data-easymde-visual-block-id="b1"><code class="language-js">${body}\n</code></pre>`
        ) as SafePreviewHtml
      };
    };
    const refreshed = deferred<PreviewResponse>();
    let holdRefresh = false;
    vi.mocked(props.previewPort.render).mockImplementation((request) => {
      if (holdRefresh
        && request.markdown === expectedCommitted
        && !isCodeContentQuery(request)) {
        return refreshed.promise;
      }
      if (isCodeContentQuery(request)) {
        // The menu's own code-content query is answered truthfully for the
        // committed source, so the code-block actions are genuinely available.
        // The helper resolves the code target from the FENCE it renders, so it
        // is given the fence text the request asked for.
        try {
          return Promise.resolve(
            createCodeContentPreviewResponse(
              request,
              request.markdown,
              request.markdown.indexOf('alpha'),
              `alpha${String.fromCharCode(10)}z${String.fromCharCode(10)}`
            )
          );
        } catch {
          return Promise.resolve(responseFor(request));
        }
      }
      return Promise.resolve(responseFor(request));
    });
    const view = render(<EditorRoot {...props} />);
    try {
      fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
      fireEvent.click(view.getByRole('button', { name: '预览' }));
      await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
      layoutPreviewSurface(view.container);
      fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
      const visual = await view.findByRole('textbox', { name: '可视化文章编辑器' });
      await waitFor(() =>
        expect(visual.getAttribute('data-easymde-preview-phase')).toBe('ready')
      );
      const oldPre = visual.querySelector('pre');
      const codeBody = oldPre?.querySelector('code')?.firstChild;
      if (!(oldPre instanceof HTMLElement) || !(codeBody instanceof Text)) {
        throw new Error('single-demand-code-body-missing');
      }
      visual.focus();
      const placeCaret = (offset: number) => {
        const range = document.createRange();
        range.setStart(codeBody, offset);
        range.collapse(true);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      };
      // One native burst: a line break inside the code body, then a plain
      // character, both inside the input debounce. The owner consumes the line
      // break itself, so the DOM mutation is issued only when the event was
      // not prevented - exactly what a browser would do.
      const offset = codeBody.data.length;
      placeCaret(offset);
      const lineBreak = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        data: null,
        inputType: 'insertLineBreak'
      });
      visual.dispatchEvent(lineBreak);
      if (!lineBreak.defaultPrevented) {
        codeBody.insertData(offset, '\n');
        placeCaret(offset + 1);
      }
      visual.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          data: null,
          inputType: 'insertLineBreak'
        })
      );
      const typedAt = codeBody.data.length;
      placeCaret(typedAt);
      const typed = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        data: 'z',
        inputType: 'insertText'
      });
      visual.dispatchEvent(typed);
      if (!typed.defaultPrevented) {
        codeBody.insertData(typedAt, 'z');
        placeCaret(typedAt + 1);
      }
      visual.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          data: 'z',
          inputType: 'insertText'
        })
      );
      // The burst commits the exact current source, including the new code
      // line; a mere "changed" document would let a stale fence through.
      await waitFor(() =>
        expect(props.submissionField.value).toBe(expectedCommitted)
      );
      const committed = props.submissionField.value;

      // Hold only the re-authentication the demand itself requests. Demand and
      // session requests are counted separately from the menu's own code-content
      // query renders, which are a different and legitimate request kind.
      const demandRequests = (): PreviewRequest[] =>
        demandRenders(vi.mocked(props.previewPort.render));
      const requestsBeforeGesture = demandRequests().length;
      holdRefresh = true;
      const pre = visual.querySelector('pre');
      if (!(pre instanceof HTMLElement)) {
        throw new Error('single-demand-pre-missing');
      }
      layoutContextMenuSurface(pre);
      fireEvent.pointerDown(pre, { button: 2, clientX: 20, clientY: 20 });
      fireEvent.contextMenu(pre, { clientX: 20, clientY: 20 });

      // While that render is held there is no menu and no stale-map failure.
      await waitFor(() =>
        expect(demandRequests().length).toBe(requestsBeforeGesture + 1)
      );
      const demandRequest = demandRequests().at(-1);
      expect(demandRequest?.markdown).toBe(committed);
      expect(within(document.body).queryAllByRole('menu')).toHaveLength(0);
      expect(props.submissionField.value).toBe(committed);

      // Accept exactly that response: the old PRE must be retired and a fresh
      // accepted DOM installed before the same gesture opens its menu.
      refreshed.resolve({
        ...responseFor(demandRequest as PreviewRequest),
        editMap: {
          blocks: [
            { editable: true, endLine: 1, id: 'b0', startLine: 0 },
            { editable: true, endLine: 6, id: 'b1', startLine: 2 }
          ],
          coordinate: 'line' as const,
          signature: (demandRequest as PreviewRequest).signature,
          version: 1 as const
        }
      });
      await waitFor(
        () =>
          expect(within(document.body).queryAllByRole('menu')).toHaveLength(1),
        { timeout: 5000 }
      );
      expect(pre.isConnected).toBe(false);
      const acceptedPre = visual.querySelector('pre');
      expect(acceptedPre).not.toBeNull();
      expect(visual.getAttribute('contenteditable')).toBe('true');
      expect(
        vi.mocked(props.onFailure).mock.calls.map((call) => call[0])
      ).toEqual([]);
      // Exactly one DEMAND/SESSION request belongs to this gesture; no retry
      // occurred. The code-content query render is counted separately and is
      // still observed by its own signature below.
      expect(demandRequests().length).toBe(requestsBeforeGesture + 1);
      expect(
        vi.mocked(props.previewPort.render).mock.calls.some(
          ([request]) => isCodeContentQuery(request)
        )
      ).toBe(true);

      // Copy must reproduce the whole CURRENT fence, typed line included. The
      // code actions live in the code-block submenu.
      fireEvent.mouseEnter(
        within(within(document.body).getByRole('menu')).getByRole('menuitem', {
          name: /^Code block/
        })
      );
      fireEvent.click(
        await within(document.body).findByRole('menuitem', {
          name: /^Copy code block/
        })
      );
      await waitFor(() =>
        expect(props.editorClipboardPort?.write).toHaveBeenCalled()
      );
      const written = vi
        .mocked(props.editorClipboardPort?.write ?? (() => undefined))
        .mock.calls.at(-1)?.[0];
      expect(written).toBe(`${fence}js\nalpha\nz\n${fence}`);
      expect(props.submissionField.value).toBe(committed);
    } finally {
      view.unmount();
    }
  });

  it('runs an ordinary fence-free context action after a native edit with exact native history', async () => {
    // A document with no fenced block at all: the menu must still be an ordinary
    // text menu, and the actual canonical Cut plus native Undo/Redo must work on
    // the typed bytes. No PRE may exist, so a code-only proof cannot pass here.
    const props = fixture();
    const initial = 'Alpha beta';
    props.submissionField.value = initial;
    props.submissionField.defaultValue = initial;
    props.submissionField.setSelectionRange(initial.length, initial.length);
    const realCreateDocumentSession =
      observedSourceAdapter.createCodeMirrorDocumentSession;
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
      Promise.resolve(
        createPreviewResponse(
          request,
          `<p data-easymde-visual-block-id="b0">${request.markdown}</p>` as SafePreviewHtml,
          {}
        )
      )
    );
    const view = render(<EditorRoot {...props} />);
    try {
      fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
      fireEvent.click(view.getByRole('button', { name: '预览' }));
      await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
      layoutPreviewSurface(view.container);
      fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
      const visual = await view.findByRole('textbox', { name: '可视化文章编辑器' });
      await waitFor(() =>
        expect(visual.getAttribute('data-easymde-preview-phase')).toBe('ready')
      );
      const owner = documentOwnerRef.current;
      if (!owner) throw new Error('fence-free-document-owner-missing');
      // There is genuinely no code block anywhere in this surface.
      expect(visual.querySelector('pre')).toBeNull();
      expect(owner.getValue()).not.toContain('```');

      // The owner may reflow the paragraph after committing, so the caret is
      // always placed against the text node that is live right now.
      const surfaceText = (): Text => {
        const candidate = visual.querySelector('p')?.firstChild;
        if (!(candidate instanceof Text)) {
          throw new Error('fence-free-paragraph-missing');
        }
        return candidate;
      };
      visual.focus();
      const placeCaret = (node: Text, offset: number) => {
        const range = document.createRange();
        range.setStart(node, offset);
        range.collapse(true);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      };
      // A multi-character native burst in the ordinary paragraph: one event per
      // character, exactly as the browser delivers ordinary typing.
      for (const character of ' z') {
        const node = surfaceText();
        placeCaret(node, node.data.length);
        const typed = new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          data: character,
          inputType: 'insertText'
        });
        visual.dispatchEvent(typed);
        if (!typed.defaultPrevented) {
          node.insertData(node.data.length, character);
          placeCaret(node, node.data.length);
        }
        visual.dispatchEvent(
          new InputEvent('input', {
            bubbles: true,
            data: character,
            inputType: 'insertText'
          })
        );
      }
      const typedSource = 'Alpha beta z';
      await waitFor(() => expect(owner.getValue()).toBe(typedSource));
      const typedHistory = owner.getHistoryState();

      // Select the typed word natively and open the ordinary menu on it.
      const text = surfaceText();
      const selectFrom = typedSource.indexOf('beta');
      const selection = window.getSelection();
      const range = document.createRange();
      range.setStart(text, selectFrom);
      range.setEnd(text, selectFrom + 'beta'.length);
      selection?.removeAllRanges();
      selection?.addRange(range);
      const paragraph = text.parentElement;
      if (!(paragraph instanceof HTMLElement)) {
        throw new Error('fence-free-paragraph-element-missing');
      }
      layoutContextMenuSurface(paragraph);
      fireEvent.pointerDown(paragraph, { button: 2, clientX: 20, clientY: 20 });
      fireEvent.contextMenu(paragraph, { clientX: 20, clientY: 20 });
      const menu = await within(document.body).findByRole('menu');
      expect(within(menu).queryByRole('menuitem', { name: 'Code block' })).toBeNull();
      fireEvent.click(within(menu).getByRole('menuitem', { name: /^Cut$/ }));
      const cutSource = 'Alpha  z';
      await waitFor(() =>
        expect(props.editorClipboardPort?.write).toHaveBeenCalledWith(
          'beta',
          expect.objectContaining({ signal: expect.any(AbortSignal) })
        )
      );
      await waitFor(() => expect(owner.getValue()).toBe(cutSource));
      expect(owner.getHistoryState().undoDepth).toBe(typedHistory.undoDepth + 1);
      await waitFor(() =>
        expect(visual.getAttribute('data-easymde-preview-phase')).toBe('ready')
      );

      // Native keyboard history over the actual canonical document.
      fireEvent.keyDown(visual, { cancelable: true, ctrlKey: true, key: 'z' });
      await waitFor(() => expect(owner.getValue()).toBe(typedSource));
      fireEvent.keyDown(visual, {
        cancelable: true,
        ctrlKey: true,
        key: 'z',
        shiftKey: true
      });
      await waitFor(() => expect(owner.getValue()).toBe(cutSource));
      fireEvent.keyDown(visual, { cancelable: true, ctrlKey: true, key: 'z' });
      await waitFor(() => expect(owner.getValue()).toBe(typedSource));
      // Nothing in this row ever became a fence, so the executed actions were
      // ordinary text commands on ordinary text.
      expect(visual.querySelector('pre')).toBeNull();
      expect(owner.getValue()).not.toContain(String.fromCharCode(96).repeat(3));
      expect(props.onFailure).not.toHaveBeenCalled();
    } finally {
      view.unmount();
    }
  });

  it('keeps fence bytes intact for an ordinary action after the last fence', async () => {
    // A fence followed by an ordinary paragraph: typing and acting after the
    // LAST fence must keep the fence exactly as accepted. A code-only signature
    // cannot certify this consumer, so the assertion is on exact bytes.
    const fence = String.fromCharCode(96).repeat(3);
    const initial = `${fence}js\nalpha\n${fence}\n\nTail`;
    const props = fixture();
    props.submissionField.value = initial;
    props.submissionField.defaultValue = initial;
    props.submissionField.setSelectionRange(0, 0);
    // A response builder over the ACTUAL requested source, so a re-render can
    // never restore stale paragraph text under a live selection.
    const responseFor = (request: PreviewRequest): PreviewResponse => {
      const lines = request.markdown.split('\n');
      const openIndex = lines.findIndex((line) =>
        new RegExp(`^${fence}[^${fence}]*$`, 'u').test(line)
      );
      const closeIndex = openIndex < 0
        ? -1
        : lines.findIndex((line, index) =>
            index > openIndex && line.startsWith(fence)
          );
      if (openIndex < 0 || closeIndex < 0) {
        throw new Error(`after-last-fence-source-without-fence:${request.markdown}`);
      }
      const body = lines.slice(openIndex + 1, closeIndex).join('\n');
      const paragraph = lines
        .slice(closeIndex + 1)
        .filter((line) => '' !== line)
        .join('\n');
      return {
        editMap: {
          blocks: [
            {
              editable: true,
              endLine: closeIndex + 1,
              id: 'b0',
              startLine: openIndex
            },
            {
              editable: true,
              endLine: lines.length,
              id: 'b1',
              startLine: closeIndex + 2
            }
          ],
          coordinate: 'line' as const,
          signature: request.signature,
          version: 1 as const
        },
        features: {},
        html: (
          `<pre data-easymde-visual-block-id="b0"><code class="language-js">${body}\n</code></pre>`
          + `<p data-easymde-visual-block-id="b1">${paragraph}</p>`
        ) as SafePreviewHtml
      };
    };
    const realCreateDocumentSession =
      observedSourceAdapter.createCodeMirrorDocumentSession;
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
      Promise.resolve(responseFor(request))
    );
    const view = render(<EditorRoot {...props} />);
    try {
      fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
      fireEvent.click(view.getByRole('button', { name: '预览' }));
      await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
      layoutPreviewSurface(view.container);
      fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
      const visual = await view.findByRole('textbox', { name: '可视化文章编辑器' });
      await waitFor(() =>
        expect(visual.getAttribute('data-easymde-preview-phase')).toBe('ready')
      );
      const owner = documentOwnerRef.current;
      if (!owner) throw new Error('after-last-fence-owner-missing');
      const tailText = (): Text => {
        const candidate = visual.querySelector('p')?.firstChild;
        if (!(candidate instanceof Text)) {
          throw new Error('after-last-fence-paragraph-missing');
        }
        return candidate;
      };
      visual.focus();
      const placeCaret = (node: Text, offset: number) => {
        const range = document.createRange();
        range.setStart(node, offset);
        range.collapse(true);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      };
      for (const character of 'ed') {
        const node = tailText();
        placeCaret(node, node.data.length);
        const typed = new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          data: character,
          inputType: 'insertText'
        });
        visual.dispatchEvent(typed);
        if (!typed.defaultPrevented) {
          node.insertData(node.data.length, character);
          placeCaret(node, node.data.length);
        }
        visual.dispatchEvent(
          new InputEvent('input', {
            bubbles: true,
            data: character,
            inputType: 'insertText'
          })
        );
      }
      const typedSource = `${fence}js\nalpha\n${fence}\n\nTailed`;
      await waitFor(() => expect(owner.getValue()).toBe(typedSource));

      // Act on the trailing paragraph itself, not on the fence.
      const tail = tailText();
      const range = document.createRange();
      range.selectNodeContents(tail);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      const paragraph = tail.parentElement;
      if (!(paragraph instanceof HTMLElement)) {
        throw new Error('after-last-fence-paragraph-element-missing');
      }
      layoutContextMenuSurface(paragraph);
      fireEvent.pointerDown(paragraph, { button: 2, clientX: 20, clientY: 20 });
      fireEvent.contextMenu(paragraph, { clientX: 20, clientY: 20 });
      const menu = await within(document.body).findByRole('menu');
      // The demand describes the paragraph, so the code submenu is absent.
      expect(within(menu).queryByRole('menuitem', { name: 'Code block' })).toBeNull();
      fireEvent.click(
        within(menu).getByRole('menuitem', { name: 'Copy / Paste as' })
      );
      fireEvent.click(
        await within(document.body).findByRole('menuitem', {
          name: 'Copy as Markdown'
        })
      );
      await waitFor(() =>
        expect(props.editorClipboardPort?.write).toHaveBeenCalledWith('Tailed')
      );
      // The fence is byte-identical and nothing else moved.
      expect(owner.getValue()).toBe(typedSource);
      expect(owner.getValue().startsWith(`${fence}js\nalpha\n${fence}\n\n`)).toBe(
        true
      );
      expect(props.onFailure).not.toHaveBeenCalled();
    } finally {
      view.unmount();
    }
  });

  it('completes the same first pointer gesture when it arrives inside the input debounce', async () => {
    // The debounce boundary: the right-click is dispatched immediately after the
    // native input events, with no wait for the committed document. The owner's
    // preflight must settle that already-authored input, so the demand captures
    // and completes against the post-burst source - one menu, one matching
    // refresh - instead of describing the pre-typing document.
    const fence = String.fromCharCode(96).repeat(3);
    const initial = `Lead\n\n${fence}js\nalpha\n${fence}\n`;
    const expectedCommitted = `Lead\n\n${fence}js\nalpha\nz\n${fence}\n`;
    const props = fixture();
    props.submissionField.value = initial;
    props.submissionField.defaultValue = initial;
    props.submissionField.setSelectionRange(0, 0);
    const responseFor = (request: PreviewRequest): PreviewResponse => {
      const lines = request.markdown.split('\n');
      const openIndex = lines.findIndex((line) =>
        new RegExp(`^${fence}[^${fence}]*$`, 'u').test(line)
      );
      const closeIndex = openIndex < 0
        ? -1
        : lines.findIndex((line, index) =>
            index > openIndex && line.startsWith(fence)
          );
      if (openIndex < 0 || closeIndex < 0) {
        throw new Error(`immediate-gesture-source-without-fence:${request.markdown}`);
      }
      const body = lines.slice(openIndex + 1, closeIndex).join('\n');
      return {
        editMap: {
          blocks: [
            { editable: true, endLine: 1, id: 'b0', startLine: 0 },
            {
              editable: true,
              endLine: closeIndex + 1,
              id: 'b1',
              startLine: openIndex
            }
          ],
          coordinate: 'line' as const,
          signature: request.signature,
          version: 1 as const
        },
        features: {},
        html: (
          '<p data-easymde-visual-block-id="b0">Lead</p>'
          + `<pre data-easymde-visual-block-id="b1"><code class="language-js">${body}\n</code></pre>`
        ) as SafePreviewHtml
      };
    };
    vi.mocked(props.previewPort.render).mockImplementation((request) => {
      if (request.markdown !== initial && request.markdown !== expectedCommitted) {
        throw new Error(`immediate-gesture-unexpected-source:${request.markdown}`);
      }
      return Promise.resolve(responseFor(request));
    });
    const view = render(<EditorRoot {...props} />);
    try {
      fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
      fireEvent.click(view.getByRole('button', { name: '预览' }));
      await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
      layoutPreviewSurface(view.container);
      fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
      const visual = await view.findByRole('textbox', { name: '可视化文章编辑器' });
      await waitFor(() =>
        expect(visual.getAttribute('data-easymde-preview-phase')).toBe('ready')
      );
      const codeBody = visual.querySelector('pre > code')?.firstChild;
      if (!(codeBody instanceof Text)) {
        throw new Error('immediate-gesture-code-body-missing');
      }
      visual.focus();
      const placeCaret = (offset: number) => {
        const range = document.createRange();
        range.setStart(codeBody, offset);
        range.collapse(true);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      };
      const offset = codeBody.data.length;
      placeCaret(offset);
      const lineBreak = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        data: null,
        inputType: 'insertLineBreak'
      });
      visual.dispatchEvent(lineBreak);
      if (!lineBreak.defaultPrevented) {
        codeBody.insertData(offset, '\n');
        placeCaret(offset + 1);
      }
      visual.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          data: null,
          inputType: 'insertLineBreak'
        })
      );
      const typedAt = codeBody.data.length;
      placeCaret(typedAt);
      const typed = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        data: 'z',
        inputType: 'insertText'
      });
      visual.dispatchEvent(typed);
      if (!typed.defaultPrevented) {
        codeBody.insertData(typedAt, 'z');
        placeCaret(typedAt + 1);
      }
      visual.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          data: 'z',
          inputType: 'insertText'
        })
      );
      // No commit wait: this is the immediate gesture.
      const pre = visual.querySelector('pre');
      if (!(pre instanceof HTMLElement)) {
        throw new Error('immediate-gesture-pre-missing');
      }
      layoutContextMenuSurface(pre);
      fireEvent.pointerDown(pre, { button: 2, clientX: 20, clientY: 20 });
      fireEvent.contextMenu(pre, { clientX: 20, clientY: 20 });

      // The committed document is exactly the post-burst source, and the menu
      // describes it: the demand never captured the pre-typing document.
      await waitFor(
        () =>
          expect(within(document.body).queryAllByRole('menu')).toHaveLength(1),
        { timeout: 5000 }
      );
      expect(props.submissionField.value).toBe(expectedCommitted);
      expect(
        vi.mocked(props.previewPort.render).mock.calls.some(
          ([request]) => request.markdown === expectedCommitted
        )
      ).toBe(true);
      expect(
        vi.mocked(props.onFailure).mock.calls.map((call) => call[0])
      ).toEqual([]);
      // Exactly one re-authentication of the committed source, and the PRE the
      // gesture was retired from is gone: only the freshly accepted DOM may
      // carry the menu. Only DEMAND/SESSION renders count here - the menu's own
      // `editor-code-content:` query is a different, legitimate request kind for
      // the same markdown.
      expect(
        vi.mocked(props.previewPort.render).mock.calls.filter(
          ([request]) =>
            request.markdown === expectedCommitted
            && !isCodeContentQuery(request)
        )
      ).toHaveLength(1);
      const acceptedPre = visual.querySelector('pre');
      expect(acceptedPre).not.toBeNull();
      expect(acceptedPre).not.toBe(pre);
      expect(pre.isConnected).toBe(false);
      // The code actions live in the code-block submenu.
      fireEvent.mouseEnter(
        within(within(document.body).getByRole('menu')).getByRole('menuitem', {
          name: /^Code block/
        })
      );
      fireEvent.click(
        await within(document.body).findByRole('menuitem', {
          name: /^Copy code block/
        })
      );
      await waitFor(() =>
        expect(props.editorClipboardPort?.write).toHaveBeenCalled()
      );
      expect(
        vi.mocked(props.editorClipboardPort?.write ?? (() => undefined))
          .mock.calls.at(-1)?.[0]
      ).toBe(`${fence}js\nalpha\nz\n${fence}`);
      expect(props.submissionField.value).toBe(expectedCommitted);
    } finally {
      view.unmount();
    }
  });

  it('cuts the whole refreshed fence from the first gesture with exact native history', async () => {
    // The Cut sibling of the Copy row: the same one-gesture re-authentication,
    // then a real Clipboard write and the exact canonical fence removal. Native
    // Undo must restore the TYPED document (not the pre-typing baseline), Redo
    // must restore the exact cut, and Undo again the typed document.
    const fence = String.fromCharCode(96).repeat(3);
    const initial = `Lead\n\n${fence}js\nalpha\n${fence}\n`;
    const typedSource = `Lead\n\n${fence}js\nalpha\nz\n${fence}\n`;
    // The Cut removes the fence block itself; the separator newline that
    // followed it stays, so the surviving paragraph keeps its own trailing
    // line terminator (the block range stops before it, see
    // `blockRangeWithTrailingTerminator` in EditorRoot.tsx:360).
    const cutSource = 'Lead\n\n\n';
    const props = fixture();
    props.submissionField.value = initial;
    props.submissionField.defaultValue = initial;
    props.submissionField.setSelectionRange(0, 0);
    const responseFor = (request: PreviewRequest): PreviewResponse => {
      const lines = request.markdown.split('\n');
      const openIndex = lines.findIndex((line) =>
        new RegExp(`^${fence}[^${fence}]*$`, 'u').test(line)
      );
      const closeIndex = openIndex < 0
        ? -1
        : lines.findIndex((line, index) =>
            index > openIndex && line.startsWith(fence)
          );
      const body = openIndex < 0 || closeIndex < 0
        ? ''
        : lines.slice(openIndex + 1, closeIndex).join('\n');
      const blocks = openIndex < 0 || closeIndex < 0
        ? [{ editable: true, endLine: 1, id: 'b0', startLine: 0 }]
        : [
            { editable: true, endLine: 1, id: 'b0', startLine: 0 },
            {
              editable: true,
              endLine: closeIndex + 1,
              id: 'b1',
              startLine: openIndex
            }
          ];
      return {
        editMap: {
          blocks,
          coordinate: 'line' as const,
          signature: request.signature,
          version: 1 as const
        },
        features: {},
        html: (
          '<p data-easymde-visual-block-id="b0">Lead</p>'
          + (openIndex < 0 || closeIndex < 0
            ? ''
            : `<pre data-easymde-visual-block-id="b1"><code class="language-js">${body}\n</code></pre>`)
        ) as SafePreviewHtml
      };
    };
    // Hold only the re-authentication this gesture requests, exactly as the
    // Copy sibling does, so the Cut path is proved with the same lifecycle
    // barriers instead of a render that settles immediately.
    const refreshed = deferred<PreviewResponse>();
    let holdRefresh = false;
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      holdRefresh && request.markdown === typedSource
        ? refreshed.promise
        : Promise.resolve(responseFor(request))
    );
    const realCreateDocumentSession =
      observedSourceAdapter.createCodeMirrorDocumentSession;
    const documentOwnerRef: {
      current: ReturnType<typeof realCreateDocumentSession> | null;
    } = { current: null };
    vi.spyOn(observedSourceAdapter, 'createCodeMirrorDocumentSession')
      .mockImplementation((options) => {
        const owner = realCreateDocumentSession(options);
        documentOwnerRef.current = owner;
        return owner;
      });
    const view = render(<EditorRoot {...props} />);
    try {
      fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
      fireEvent.click(view.getByRole('button', { name: '预览' }));
      await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
      layoutPreviewSurface(view.container);
      fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
      const visual = await view.findByRole('textbox', { name: '可视化文章编辑器' });
      await waitFor(() =>
        expect(visual.getAttribute('data-easymde-preview-phase')).toBe('ready')
      );
      const owner = documentOwnerRef.current;
      if (!owner) throw new Error('cut-document-owner-missing');
      const codeBody = visual.querySelector('pre > code')?.firstChild;
      if (!(codeBody instanceof Text)) {
        throw new Error('cut-code-body-missing');
      }
      visual.focus();
      const placeCaret = (offset: number) => {
        const range = document.createRange();
        range.setStart(codeBody, offset);
        range.collapse(true);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      };
      const offset = codeBody.data.length;
      placeCaret(offset);
      const lineBreak = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        data: null,
        inputType: 'insertLineBreak'
      });
      visual.dispatchEvent(lineBreak);
      if (!lineBreak.defaultPrevented) {
        codeBody.insertData(offset, '\n');
        placeCaret(offset + 1);
      }
      visual.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          data: null,
          inputType: 'insertLineBreak'
        })
      );
      const typedAt = codeBody.data.length;
      placeCaret(typedAt);
      const typed = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        data: 'z',
        inputType: 'insertText'
      });
      visual.dispatchEvent(typed);
      if (!typed.defaultPrevented) {
        codeBody.insertData(typedAt, 'z');
        placeCaret(typedAt + 1);
      }
      visual.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          data: 'z',
          inputType: 'insertText'
        })
      );
      await waitFor(() => expect(owner.getValue()).toBe(typedSource));
      const typedHistory = owner.getHistoryState();

      // Hold the refresh the demand itself requests, then open the one gesture.
      // Demand/session renders only: the menu's `editor-code-content:` query is
      // a different, legitimate request kind.
      const demandRequests = (): PreviewRequest[] =>
        demandRenders(vi.mocked(props.previewPort.render));
      const requestsBeforeGesture = demandRequests().length;
      holdRefresh = true;
      const pre = visual.querySelector('pre');
      if (!(pre instanceof HTMLElement)) {
        throw new Error('cut-pre-missing');
      }
      layoutContextMenuSurface(pre);
      fireEvent.pointerDown(pre, { button: 2, clientX: 20, clientY: 20 });
      fireEvent.contextMenu(pre, { clientX: 20, clientY: 20 });

      // While the re-authentication is held: exactly one request for the typed
      // source, no menu, and no canonical or history change from the gesture.
      await waitFor(() =>
        expect(demandRequests().length).toBe(requestsBeforeGesture + 1)
      );
      const demandRequest = demandRequests().at(-1);
      expect(demandRequest?.markdown).toBe(typedSource);
      expect(within(document.body).queryAllByRole('menu')).toHaveLength(0);
      expect(owner.getValue()).toBe(typedSource);
      expect(owner.getHistoryState()).toEqual(typedHistory);
      expect(props.submissionField.value).toBe(typedSource);

      // Accept exactly that response: the retired PRE must be replaced before
      // the same gesture opens its menu.
      refreshed.resolve({
        ...responseFor(demandRequest as PreviewRequest),
        editMap: {
          blocks: [
            { editable: true, endLine: 1, id: 'b0', startLine: 0 },
            { editable: true, endLine: 6, id: 'b1', startLine: 2 }
          ],
          coordinate: 'line' as const,
          signature: (demandRequest as PreviewRequest).signature,
          version: 1 as const
        }
      });
      await waitFor(
        () =>
          expect(within(document.body).queryAllByRole('menu')).toHaveLength(1),
        { timeout: 5000 }
      );
      expect(pre.isConnected).toBe(false);
      const acceptedPre = visual.querySelector('pre');
      // An explicit guard narrows the nullable query result for the later
      // ownership assertion. `expect(...).not.toBeNull()` is not a TypeScript
      // narrowing, and the exact typing is what keeps the check honest instead
      // of an optional chain or a non-null assertion.
      if (!acceptedPre) {
        throw new Error('cut-accepted-pre-missing');
      }
      expect(acceptedPre).not.toBe(pre);
      expect(visual.getAttribute('contenteditable')).toBe('true');
      // Only the demanded refresh was held; later Cut and history renders use
      // their own responses.
      holdRefresh = false;
      // One request belongs to this gesture, and the committed document is
      // still exactly the typed source the request described.
      expect(demandRequests().length).toBe(requestsBeforeGesture + 1);
      expect(owner.getValue()).toBe(typedSource);
      expect(owner.getHistoryState()).toEqual(typedHistory);
      expect(props.onFailure).not.toHaveBeenCalled();

      fireEvent.click(
        within(within(document.body).getByRole('menu')).getByRole('menuitem', {
          name: /^Cut$/
        })
      );
      await waitFor(() =>
        expect(props.editorClipboardPort?.write).toHaveBeenCalledWith(
          `${fence}js\nalpha\nz\n${fence}`,
          expect.objectContaining({ signal: expect.any(AbortSignal) })
        )
      );
      await waitFor(() => expect(owner.getValue()).toBe(cutSource));
      // Exactly one canonical history entry for the Cut, and no orphan fence.
      expect(owner.getHistoryState().undoDepth).toBe(typedHistory.undoDepth + 1);
      expect(owner.getHistoryState().redoDepth).toBe(0);
      expect(owner.getValue()).not.toContain(fence);
      // The Cut's own accepted surface: the fence block is gone from the
      // accepted DOM, and the editor is still editable.
      await waitFor(() => expect(visual.querySelector('pre')).toBeNull());
      await waitFor(() =>
        expect(visual.getAttribute('data-easymde-preview-phase')).toBe('ready')
      );
      expect(visual.getAttribute('contenteditable')).toBe('true');

      // Each native transition is proved by its OWN accepted DOM shape, not by
      // a phase string that can still be `ready` from the previous state: the
      // fence is absent after the Cut and present again only once Undo restores
      // it.
      // The typed fence body after the burst is exactly `alpha`, the new line,
      // and `z`, with the formatter's terminal body LF. Asserting the exact
      // bytes is what proves the accepted DOM carries the whole typed fence
      // rather than a truncated or otherwise different code block.
      const typedCodeBody = 'alpha\nz\n';
      const awaitAcceptedSurface = async (prePresent: boolean): Promise<void> => {
        // `prePresent` is the semantic outcome of this transition:
        // true = the typed fence must be back in the accepted DOM,
        // false = the fence must really be gone from it.
        if (prePresent) {
          await waitFor(() => {
            const fences = visual.querySelectorAll('pre');
            expect(fences).toHaveLength(1);
            expect(fences[0]?.querySelector('code')?.textContent).toBe(
              typedCodeBody
            );
          });
        } else {
          await waitFor(() => expect(visual.querySelectorAll('pre')).toHaveLength(0));
        }
        await waitFor(() =>
          expect(visual.getAttribute('data-easymde-preview-phase')).toBe('ready')
        );
        expect(visual.getAttribute('contenteditable')).toBe('true');
      };

      // Native history: Undo restores the TYPED fence, not the pre-typing one.
      fireEvent.keyDown(visual, { cancelable: true, ctrlKey: true, key: 'z' });
      await waitFor(() => expect(owner.getValue()).toBe(typedSource));
      await awaitAcceptedSurface(true);
      expect(owner.getHistoryState().undoDepth).toBe(typedHistory.undoDepth);
      expect(owner.getHistoryState().redoDepth).toBe(1);
      fireEvent.keyDown(visual, {
        cancelable: true,
        ctrlKey: true,
        key: 'z',
        shiftKey: true
      });
      await waitFor(() => expect(owner.getValue()).toBe(cutSource));
      // Redo completes its own accepted surface: the fence really leaves the DOM
      // again, so the later Undo is not credited with a state it never left.
      await awaitAcceptedSurface(false);
      expect(owner.getHistoryState().undoDepth).toBe(typedHistory.undoDepth + 1);
      expect(owner.getHistoryState().redoDepth).toBe(0);
      fireEvent.keyDown(visual, { cancelable: true, ctrlKey: true, key: 'z' });
      await waitFor(() => expect(owner.getValue()).toBe(typedSource));
      // The final Undo also completes its own accepted surface state: the
      // editor is editable again, the typed fence is back in the DOM, and no
      // history entry was added by the restore.
      await awaitAcceptedSurface(true);
      const restoredPre = visual.querySelector('pre');
      expect(restoredPre).not.toBeNull();
      // Reuse the same exact-bytes oracle instead of a weaker duplicate: the
      // restored PRE must carry the full typed fence body, not merely a `z`.
      expect(restoredPre?.querySelector('code')?.textContent).toBe(typedCodeBody);
      // The Cut entry now sits on the redo side: this Undo undid it, so undo is
      // back at the typed depth and exactly one redo is available.
      expect(owner.getHistoryState().undoDepth).toBe(typedHistory.undoDepth);
      expect(owner.getHistoryState().redoDepth).toBe(1);
      // The PRE accepted for the demand is the detached one from before the
      // Cut: the restores mounted their own block, not that retired element.
      expect(acceptedPre.isConnected).toBe(false);
      expect(visual.querySelectorAll('pre')).toHaveLength(1);
      expect(props.onFailure).not.toHaveBeenCalled();
    } finally {
      view.unmount();
    }
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

    // A prior accepted identity can fail for the same reason before this
    // action ever starts, and `is-preview` is already true here, so neither
    // proves that THIS demand settled. Record the failure count first and
    // require a new callback from the action under test.
    const failuresBefore = vi.mocked(props.onFailure).mock.calls.slice();

    fireEvent.click(view.getByRole('button', { name: 'Link' }));

    await waitFor(() =>
      expect(
        vi.mocked(props.onFailure).mock.calls.length
      ).toBeGreaterThan(failuresBefore.length)
    );
    const addedFailures = vi
      .mocked(props.onFailure)
      .mock.calls.slice(failuresBefore.length)
      .map((call) => call[0]);
    expect(addedFailures).toContain('visual-editor-selection-map-failed');
    expect(addedFailures).not.toContain(
      'visual-editor-canonical-change-failed'
    );
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
      // Leaving visual editing is the terminal outcome for an invalidated
      // accepted DOM, and that transition dismisses the editor status surface,
      // so the failure is proved by the single reported code above plus the
      // preserved canonical state - not by a transient alert that the leave
      // itself removes.
      expect(props.onFailure).toHaveBeenCalledTimes(1);
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
        // The 320-block windowed handoff exceeds the 1000ms default query
        // budget once the host is loaded, so give the certificate update an
        // explicit budget instead of racing the window measurement.
        const visual = await view.findByRole(
          'textbox',
          { name: '可视化文章编辑器' },
          { timeout: 8000 }
        );
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
          layoutPreviewSurface(view.container);
        } else {
          await waitFor(() =>
            expect(unlock.hasAttribute('disabled')).toBe(false)
          );
        }
        fireEvent.click(unlock);

        if (frameQueue) {
          // The queued window commit arrives on a later frame than the batch
          // that is already pending when the unlock click returns, so waiting
          // for a single batch only proves a frame ran. Drain until the owner
          // actually installs its window or hands over to the visual editor;
          // the cap and spacer assertions below stay the real invariant.
          await drainAnimationFramesUntil(
            frameQueue,
            () => {
              const sink = view.container.querySelector<HTMLElement>(
                '[data-easymde-preview-html-sink="1"]'
              );
              return (
                null !== sink?.querySelector(
                  '[data-easymde-preview-window-spacer]'
                )
                || null
                  !== view.queryByRole('textbox', {
                    name: '可视化文章编辑器'
                  })
              );
            }
          );
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
    'keeps the scaled image target across the accepted scale render and refuses a mid-transfer replay (windowed=%s)',
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
      // A real renderer draws the image scale the SOURCE requests. The double
      // therefore derives the title from the requested markdown instead of
      // always returning the pre-scale markup: a fixed html would leave the
      // accepted DOM permanently describing another source, which no real
      // Preview does and which would hide the settle the row is about.
      const renderedFor = (request: { markdown: string }): string => {
        const scale = /\{width=(\d+)%\}/.exec(request.markdown);
        const title = scale ? `{width=${scale[1]}%}` : '{width=100%}';
        const image = `<p>Before <img alt="alt" src="https://example.test/original.png" title="${title}"> after</p>`;
        return windowed
          ? image +
              Array.from(
                { length: 160 },
                (_, index) => `<p>suffix ${index}</p>`
              ).join('')
          : image;
      };
      vi.mocked(props.previewPort.render).mockImplementation((request) =>
        Promise.resolve(
          createPreviewResponse(
            request,
            renderedFor(request) as SafePreviewHtml,
            {}
          )
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
      if (windowed) layoutPreviewSurface(view.container);
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

      // The canonical Markdown keeps the image's EXACT syntax. The whole
      // attribute form and the alt text are asserted, not just the width
      // fragment, because a source that lost either would still "contain"
      // `{width=50%}` while no longer being the user's image.
      const imageSource50 =
        '![alt](https://example.test/original.png "{width=50%}")';
      const scaledSource = props.submissionField.value;
      expect(scaledSource).toContain(imageSource50);
      expect(scaledSource).not.toContain('{width=100%}');
      // Exactly one width attribute: no duplication, no dropped token.
      expect((scaledSource.match(/\{width=/g) ?? []).length).toBe(1);
      // The ONLY difference from the original source is the width token, so
      // the length delta is exactly one byte shorter at 50% and every other
      // byte - line breaks, alt text, URL, spacing, the trailing paragraph -
      // is identical. This also rules out soft-break-to-space rewriting,
      // lost `\n` between blocks, and trailing-whitespace normalization.
      const expectedScaledSource = sourceMarkdown.replace(
        '{width=100%}',
        '{width=50%}'
      );
      expect(scaledSource).toBe(expectedScaledSource);
      expect(sourceMarkdown.length - scaledSource.length).toBe(1);
      expect(scaledSource.split('\n').length).toBe(
        sourceMarkdown.split('\n').length
      );
      // The canonical selection is the WHOLE image target, not a caret inside
      // image syntax: the selected slice is the image source verbatim.
      const selectionStart = props.submissionField.selectionStart ?? -1;
      const selectionEnd = props.submissionField.selectionEnd ?? -1;
      expect(
        scaledSource.slice(selectionStart, selectionEnd),
        'canonical selection covers the whole image target'
      ).toBe(imageSource50);

      // A replay that arrives BEFORE the accepted render is a different
      // gesture: the owner's own scale transfer is still pending, so the
      // demand is refused silently - no menu is built, no failure is reported,
      // the canonical source keeps the accepted `{width=50%}`, and the mounted
      // DOM still draws the pre-acceptance markup. Nothing is retried here and
      // no guard is bypassed: this is the owner's documented pending window.
      const writesBeforeScaleReplay = vi.mocked(
        props.editorClipboardPort?.write ?? (() => undefined)
      ).mock.calls.length;
      layoutContextMenuSurface(visual);
      fireEvent.contextMenu(currentImage(), { clientX: 24, clientY: 30 });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(
        within(document.body).queryAllByRole('menu'),
        'menus while the owner scale transfer is pending'
      ).toHaveLength(0);
      expect(
        vi.mocked(props.onFailure).mock.calls,
        'failures while the owner scale transfer is pending'
      ).toEqual([]);
      expect(props.submissionField.value).toBe(scaledSource);
      // The refused gesture wrote nothing at all.
      expect(
        vi.mocked(props.editorClipboardPort?.write ?? (() => undefined)).mock
          .calls.length,
        'clipboard writes during the refused mid-transfer replay'
      ).toBe(writesBeforeScaleReplay);

      // The replay waits for the ACCEPTED render of the scale, using the same
      // readiness barrier the other visual rows use: the surface phase returns
      // to `ready` and the accepted DOM draws the source's own `{width=50%}`.
      // A demand that arrives earlier belongs to the mid-transfer window and is
      // parked by the owner, so it is not the state this row is about.
      await waitFor(() =>
        expect(visual.getAttribute('data-easymde-preview-phase')).toBe('ready')
      );
      await waitFor(() =>
        expect(currentImage().getAttribute('title')).toBe('{width=50%}')
      );
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

  it.each(['response-pending', 'enhancing'] as const)(
    'keeps the windowed surface after a second HR demand while the first transfer is %s',
    async (pendingWindow) => {
    const props = fixture();
    // 320 parser-valid blocks joined by blank lines keeps the Windowed owner
    // installed before and after one deletion (319 > 160).
    const openingBlocks = [
      'alpha',
      '---',
      'beta',
      '---',
      ...Array.from({ length: 316 }, (_, index) => `suffix ${index}`)
    ];
    expect(openingBlocks).toHaveLength(320);
    const sourceMarkdown = openingBlocks.join('\n\n');
    const blockStarts: number[] = [];
    let cursor = 0;
    for (const block of openingBlocks) {
      blockStarts.push(cursor);
      cursor += block.length + 2;
    }
    const firstHrOffset = blockStarts[1];
    if (undefined === firstHrOffset) throw new Error('windowed-race-hr-offset-missing');
    // A thematic-break delete removes only the three marker bytes; both
    // surrounding newlines stay, so every later line keeps its index.
    const deletedMarkdown =
      sourceMarkdown.slice(0, firstHrOffset)
      + sourceMarkdown.slice(firstHrOffset + 3);
    const responseFor = (request: PreviewRequest): PreviewResponse => {
      const deleted = request.markdown === deletedMarkdown;
      // Block ids are positional in the rendered response, so removing HR1
      // renumbers every later block: the id HR2 used to carry now names the
      // block that shifted into its place.
      const renderedIndices = openingBlocks
        .map((_, index) => index)
        .filter((index) => !(deleted && 1 === index));
      const blocks = renderedIndices.map((sourceIndex, renderedIndex) => ({
        editable: true,
        endLine: 2 * sourceIndex + 1,
        id: `b${renderedIndex}`,
        startLine: 2 * sourceIndex
      }));
      const html = renderedIndices
        .map((sourceIndex, renderedIndex) => {
          const marker = ` data-easymde-visual-block-id="b${renderedIndex}"`;
          return '---' === openingBlocks[sourceIndex]
            ? `<hr${marker}>`
            : `<p${marker}>${openingBlocks[sourceIndex]}</p>`;
        })
        .join('');
      return {
        editMap: {
          blocks,
          coordinate: 'line',
          signature: request.signature,
          version: 1
        },
        features: {},
        html: html as SafePreviewHtml
      };
    };
    // Demand 2 must arrive while the windowed owner is still enhancing the
    // first transfer, so the real enhancement is held rather than the response.
    // Two distinct pending windows are exercised: the formal response has not
    // arrived yet, and the response arrived but its real enhancement is still
    // running (`phase=enhancing`, which is what the browser shows after a
    // Windowed delete).
    const heldEnhancement = deferred<void>();
    let holdEnhancement = 'enhancing' === pendingWindow;
    vi.mocked(props.enhancementPort.enhance).mockImplementation(
      async () => {
        // Only the post-delete transfer is held; the initial load must finish
        // so the surface reaches ready before demand 1.
        if (!holdEnhancement || documentOwnerRef.current?.getValue() !== deletedMarkdown) {
          return;
        }
        await heldEnhancement.promise;
      }
    );
    const heldResponse = deferred<PreviewResponse>();
    let holdResponse = 'response-pending' === pendingWindow;
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      request.markdown === deletedMarkdown && holdResponse
        ? heldResponse.promise
        : Promise.resolve(responseFor(request))
    );
    const realCreateDocumentSession =
      observedSourceAdapter.createCodeMirrorDocumentSession;
    const documentOwnerRef: {
      current: ReturnType<typeof realCreateDocumentSession> | null;
    } = { current: null };
    vi.spyOn(observedSourceAdapter, 'createCodeMirrorDocumentSession')
      .mockImplementation((options) => {
        const owner = realCreateDocumentSession(options);
        documentOwnerRef.current = owner;
        return owner;
      });
    props.submissionField.value = sourceMarkdown;
    props.submissionField.defaultValue = sourceMarkdown;
    props.submissionField.setSelectionRange(0, 0);
    const view = render(
      <EditorRootErrorBoundary
        failureMessage="The editor could not start."
        onFailure={props.onFailure}
      >
        <EditorRoot {...props} editorBlockIndexPort={sourceLinkBlockIndexPort()} />
      </EditorRootErrorBoundary>
    );
    // The browser right-click selects the HR token at the root, so the demand
    // starts from a root-level interval over that exact child.
    const demandOn = (target: HTMLElement): void => {
      const range = document.createRange();
      range.selectNode(target);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      layoutContextMenuSurface(target);
      fireEvent.pointerDown(target, { button: 2, clientX: 20, clientY: 20 });
      fireEvent.mouseDown(target, { button: 2, clientX: 20, clientY: 20 });
      fireEvent.contextMenu(target, { clientX: 20, clientY: 20 });
    };
    try {
      fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
      fireEvent.click(view.getByRole('button', { name: '预览' }));
      const unlock = await view.findByRole('button', { name: '解除锁定并编辑' });
      await waitFor(() => expect(unlock.hasAttribute('disabled')).toBe(false));
      layoutPreviewSurface(view.container);
      fireEvent.click(unlock);
      // The windowed handoff measures all 320 blocks before it publishes the
      // window, which exceeds the 1000ms default query budget on a loaded host.
      // The explicit budget keeps this test about the HR transfer race.
      const editor = await view.findByRole(
        'textbox',
        { name: '可视化文章编辑器' },
        { timeout: 8000 }
      );
      await waitFor(() =>
        expect(editor.getAttribute('data-easymde-preview-phase')).toBe('ready')
      );
      const owner = documentOwnerRef.current;
      if (!owner) throw new Error('windowed-race-document-owner-missing');
      const sink = view.container.querySelector<HTMLElement>(
        '[data-easymde-preview-html-sink="1"]'
      );
      if (!sink) throw new Error('windowed-race-sink-missing');
      expect(editor.querySelector('[data-easymde-preview-window-spacer]')).not.toBeNull();
      const hrs = (): Element[] => Array.from(editor.querySelectorAll('hr'));
      expect(hrs()).toHaveLength(2);
      const openingHistory = owner.getHistoryState();

      // Demand 1: delete the first HR. Its formal response is still held.
      demandOn(hrs()[0] as HTMLElement);
      const firstMenu = await within(document.body).findByRole('menu');
      fireEvent.click(
        within(firstMenu).getByRole('menuitem', { name: 'Delete horizontal rule' })
      );
      await waitFor(() => expect(owner.getValue()).toBe(deletedMarkdown));
      expect(props.submissionField.value).toBe(deletedMarkdown);
      expect(owner.getHistoryState().undoDepth).toBe(openingHistory.undoDepth + 1);
      expect(
        vi.mocked(props.onFailure).mock.calls,
        'failures after demand 1'
      ).toEqual([]);
      if ('enhancing' === pendingWindow) {
        // The accepted Preview is installed but its enhancement is still held,
        // which is the browser's `phase=enhancing` window.
        await waitFor(() =>
          expect(editor.getAttribute('data-easymde-preview-phase')).toBe('enhancing')
        );
      }

      // Demand 2 arrives with transfer 1 still pending. It is fired without
      // waiting for a menu, because a pending demand legitimately produces no
      // menu. It must not write canonical source or history, and must not
      // cancel or replace transfer 1.
      const beforeSecond = owner.getValue();
      const beforeSecondHistory = owner.getHistoryState();
      // HR1 carried b1. After the positional renumbering that id now names the
      // block that shifted up, which is not the HR the user pointed at. A
      // replayed demand must never be allowed to act on that fresh element.
      const renumberedOwner = editor.querySelector<HTMLElement>(
        '[data-easymde-visual-block-id="b1"]'
      );
      if (!renumberedOwner) throw new Error('windowed-race-b1-missing');
      const remaining = hrs();
      expect(remaining.length).toBeGreaterThan(0);
      const secondTarget = remaining[remaining.length - 1] as HTMLElement;
      // This is the falsifier: the live HR2 identity differs from whatever
      // now answers to the old b1 id.
      expect(renumberedOwner).not.toBe(secondTarget);
      demandOn(secondTarget);
      await act(async () => {
        await Promise.resolve();
      });
      const secondItem = within(document.body).queryByRole('menuitem', {
        name: 'Delete horizontal rule'
      });
      // The demand is a rejection, not a crash: no menu is installed while the
      // transfer is pending, and nothing has been written or reported.
      expect(secondItem).toBeNull();
      expect(vi.mocked(props.onFailure).mock.calls).toEqual([]);
      // The rejected demand must not have written anything.
      expect(owner.getValue()).toBe(beforeSecond);
      expect(owner.getHistoryState()).toEqual(beforeSecondHistory);
      if (secondItem && 'true' !== secondItem.getAttribute('aria-disabled')) {
        fireEvent.click(secondItem);
        await act(async () => {
          await Promise.resolve();
        });
      }
      expect(owner.getValue()).toBe(beforeSecond);
      expect(owner.getHistoryState()).toEqual(beforeSecondHistory);
      expect(props.onFailure).not.toHaveBeenCalled();

      // Release whichever stage of transfer 1 is being held.
      if ('response-pending' === pendingWindow) {
        holdResponse = false;
        heldResponse.resolve(
          responseFor(
            [...vi.mocked(props.previewPort.render).mock.calls]
              .map(([request]) => request)
              .find((request) => request.markdown === deletedMarkdown)
              ?? (() => { throw new Error('windowed-race-first-request-missing'); })()
          )
        );
      }
      holdEnhancement = false;
      heldEnhancement.resolve();
      await act(async () => {
        await heldEnhancement.promise;
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      });

      // Exactly one deletion landed; the surface is still the same live sink.
      await waitFor(() =>
        expect(editor.getAttribute('data-easymde-preview-phase')).toBe('ready')
      );
      expect(
        vi.mocked(props.onFailure).mock.calls,
        'failures after transfer 1'
      ).toEqual([]);
      expect(view.queryByRole('alert')).toBeNull();
      expect(props.onFailure).not.toHaveBeenCalled();
      expect(editor.isConnected).toBe(true);
      expect(editor.getAttribute('contenteditable')).toBe('true');
      expect(
        view.container.querySelector('[data-easymde-preview-html-sink="1"]')
      ).toBe(sink);
      expect(editor.querySelector('[data-easymde-preview-window-spacer]')).not.toBeNull();
      expect(owner.getValue()).toBe(deletedMarkdown);
      expect(hrs()).toHaveLength(1);
      // The parked demand is rebuilt against the newly accepted state once the
      // transfer settles, so a fresh gesture on the surviving HR now gets a
      // usable menu. Without the settle notification the parked demand is
      // never revisited.
      demandOn(hrs()[0] as HTMLElement);
      const settledMenu = await within(document.body).findByRole('menu');
      expect(
        within(settledMenu).getByRole('menuitem', {
          name: 'Delete horizontal rule'
        }).getAttribute('aria-disabled')
      ).toBe('false');
      expect(vi.mocked(props.onFailure).mock.calls).toEqual([]);
      fireEvent.keyDown(settledMenu, { cancelable: true, key: 'Escape' });

      // One Undo restores the exact baseline and the original accepted Preview.
      fireEvent.keyDown(editor, { cancelable: true, ctrlKey: true, key: 'z' });
      await waitFor(() => expect(owner.getValue()).toBe(sourceMarkdown));
      await waitFor(() =>
        expect(editor.getAttribute('data-easymde-preview-phase')).toBe('ready')
      );
      expect(props.submissionField.value).toBe(sourceMarkdown);
      expect(hrs()).toHaveLength(2);
      expect(owner.getHistoryState()).toEqual({
        redoDepth: openingHistory.redoDepth + 1,
        undoDepth: openingHistory.undoDepth
      });
      expect(editor.isConnected).toBe(true);
      expect(editor.getAttribute('contenteditable')).toBe('true');
      expect(
        view.container.querySelector('[data-easymde-preview-html-sink="1"]')
      ).toBe(sink);
      expect(props.onFailure).not.toHaveBeenCalled();
      expect(view.queryByRole('alert')).toBeNull();
    } finally {
      view.unmount();
    }
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
    // A windowed unlock is only admitted on a Ready Preview with a window that
    // has real layout metrics. Waiting for the button to leave its disabled
    // state and laying out the mounted blocks first keeps this test measuring
    // the owner's handoff instead of racing the enhancement and the zero-height
    // jsdom geometry.
    const unlock = await view.findByRole('button', {
      name: '解除锁定并编辑'
    });
    await waitFor(() => expect(unlock.hasAttribute('disabled')).toBe(false));
    layoutPreviewSurface(view.container);
    fireEvent.click(unlock);
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

  it.each(['readOnly', 'disabled'] as const)(
    'fails a Source table confirmation whose field became %s while the dialog was open',
    async (flag) => {
      // The dialog stays open across an arbitrary delay, so the authoritative
      // native field can change after the enabled action started and before the
      // user confirms. Confirming must fail exactly once and write neither the
      // canonical document nor history.
      const props = fixture();
      props.submissionField.value = 'selected';
      props.submissionField.defaultValue = 'selected';
      props.submissionField.setSelectionRange(0, 8);
      const realCreateDocumentSession =
        observedSourceAdapter.createCodeMirrorDocumentSession;
      const documentOwnerRef: {
        current: ReturnType<typeof realCreateDocumentSession> | null;
      } = { current: null };
      vi.spyOn(observedSourceAdapter, 'createCodeMirrorDocumentSession')
        .mockImplementation((options) => {
          const owner = realCreateDocumentSession(options);
          documentOwnerRef.current = owner;
          return owner;
        });
      const view = render(<EditorRoot {...props} />);
      try {
        const source = await waitFor(() => {
          const element = view.container.querySelector<HTMLElement>('.cm-content');
          if (!element) throw new Error('source-surface-missing');
          return element;
        });
        const owner = documentOwnerRef.current;
        if (!owner) throw new Error('source-document-owner-missing');
        layoutContextMenuSurface(source);
        fireEvent.contextMenu(source, { clientX: 20, clientY: 24 });
        await within(document.body).findByRole('menu');
        fireEvent.click(
          within(document.body).getByRole('menuitem', { name: 'Insert' })
        );
        fireEvent.click(
          await within(document.body).findByRole('menuitem', {
            name: 'Insert table above'
          })
        );
        await within(document.body).findByRole('dialog', { name: '插入表格' });
        const beforeSelection = owner.getSelection();
        const beforeHistory = owner.getHistoryState();
        const beforeRevision = owner.getRevision?.();
        if ('readOnly' === flag) props.submissionField.readOnly = true;
        else props.submissionField.disabled = true;
        expect(props.submissionField.readOnly).toBe('readOnly' === flag);
        expect(props.submissionField.disabled).toBe('disabled' === flag);
        fireEvent.click(
          within(document.body).getByRole('button', { name: '2 × 2' })
        );
        await waitFor(() =>
          expect(props.onFailure).toHaveBeenCalledWith(
            'editor-context-menu-surface-read-only'
          )
        );
        expect(view.getByRole('alert').textContent).toBe(
          contextMenuStrings.statusActionFailed
        );
        expect(owner.getValue()).toBe('selected');
        expect(props.submissionField.value).toBe('selected');
        expect(EditorView.findFromDOM(source)?.state.doc.toString()).toBe(
          'selected'
        );
        expect(owner.getSelection()).toEqual(beforeSelection);
        expect(owner.getHistoryState()).toEqual(beforeHistory);
        expect(owner.getRevision?.()).toBe(beforeRevision);
        expect(
          vi.mocked(props.onFailure).mock.calls.filter((call) =>
            call[0].startsWith('editor-context-menu-')
          )
        ).toEqual([['editor-context-menu-surface-read-only']]);

        // Restoring the flag schedules no deferred table insert.
        props.submissionField.readOnly = false;
        props.submissionField.disabled = false;
        await act(async () => {
          await Promise.resolve();
          await Promise.resolve();
        });
        expect(owner.getValue()).toBe('selected');
        expect(owner.getHistoryState()).toEqual(beforeHistory);
      } finally {
        props.submissionField.readOnly = false;
        props.submissionField.disabled = false;
        view.unmount();
      }
    }
  );

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
      captureContextMenuTarget: () => null,
      executeCommand: () => 'blocked',
      getGeneratedPreviewIdentity: () => null,
      isEditable: () => true,
      isTransferPending: () => false,
      prepareContextMenuDemand: () => true,
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
      captureContextMenuTarget: () => null,
      executeCommand: () => 'blocked',
      getGeneratedPreviewIdentity: () => null,
      isEditable: () => true,
      isTransferPending: () => false,
      prepareContextMenuDemand: () => true,
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

  it.each([
    [false, 'source', false], [true, 'source', false],
    [true, 'preview', false], [true, 'split', false],
    [true, 'preview', true], [true, 'split', true]
  ] as const)(
    'completes one Source mode request after the active formal Preview settles (windowed %s, latest mode %s, cancel during preparation %s)',
    { timeout: 15_000 },
    async (windowed, latestMode, cancelDuringPreparation) => {
      const props = fixture();
      const realCreateSession = observedSourceAdapter.createCodeMirrorDocumentSession;
      const session: { current: CodeMirrorDocumentSession | null } = { current: null };
      vi.spyOn(observedSourceAdapter, 'createCodeMirrorDocumentSession').mockImplementation((options) => {
        const owner = realCreateSession(options);
        session.current = owner;
        return owner;
      });
      const paragraphs = Array.from(
        { length: windowed ? 200 : 2 },
        (_, index) => `Paragraph ${index}`
      );
      const markdown = paragraphs.join('\n\n');
      props.submissionField.value = markdown;
      props.submissionField.defaultValue = markdown;
      props.submissionField.setSelectionRange(0, 0);
      const responseFor = (request: PreviewRequest): PreviewResponse => {
        const response = createPreviewResponse(
          request,
          request.markdown.split('\n\n').map((text) => `<p>${text}</p>`).join('') as SafePreviewHtml,
          {}
        );
        if (!response.editMap) throw new Error('pending-source-edit-map-required');
        return {
          ...response,
          editMap: {
            ...response.editMap,
            blocks: response.editMap.blocks.map((block, index) => ({
              ...block, startLine: index * 2, endLine: index * 2 + 1
            }))
          }
        };
      };
      const held = deferred<PreviewResponse>();
      const pending: { request: PreviewRequest | null; hold: boolean } = {
        request: null, hold: false
      };
      vi.mocked(props.previewPort.render).mockImplementation((request) => {
        if (pending.hold) {
          pending.request = request;
          return held.promise;
        }
        return Promise.resolve(responseFor(request));
      });
      const realPreviewOwner = observedPreviewOwner.PreviewSurfaceOwner;
      const stagingScheduler = { now: () => 0, yield: () => Promise.resolve() };
      const preparationGate = deferred<void>();
      const preparation: { paused: boolean; started: boolean; task: Promise<boolean> | null } = {
        paused: false, started: false, task: null
      };
      const materializeScheduler = { yield: () => {
        if (!preparation.paused) return Promise.resolve();
        preparation.started = true;
        return preparationGate.promise;
      } };
      let observedRuntime: observedPreviewOwner.PreviewSurfaceRuntime | null = null;
      vi.spyOn(observedPreviewOwner, 'PreviewSurfaceOwner').mockImplementation(
        (componentProps) => {
          const onReady = observedCallback((runtime: observedPreviewOwner.PreviewSurfaceRuntime) => {
            if (runtime !== observedRuntime) {
              observedRuntime = runtime;
              const materialize = runtime.materialize;
              vi.spyOn(runtime, 'materialize').mockImplementation(() => {
                const task = materialize();
                preparation.task = task;
                return task;
              });
            }
            componentProps.onReady?.(runtime);
          }, [componentProps.onReady]);
          return realPreviewOwner({ ...componentProps, onReady, stagingScheduler, materializeScheduler });
        }
      );
      const view = render(<EditorRoot {...props} />);
      try {
        fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
        fireEvent.click(view.getByRole('button', { name: '预览模式' }));
        const unlock = await view.findByRole('button', { name: '解除锁定并编辑' });
        await waitFor(() => expect(unlock.hasAttribute('disabled')).toBe(false));
        layoutPreviewSurface(view.container);
        fireEvent.click(unlock);
        const visual = await view.findByRole('textbox', { name: '可视化文章编辑器' });
        await waitFor(() => expect(visual.getAttribute('contenteditable')).toBe('true'));
        expect(!!visual.querySelector('[data-easymde-preview-window-spacer]')).toBe(windowed);
        const text = visual.querySelector('p')?.firstChild;
        if (!(text instanceof Text)) throw new Error('pending-source-paragraph-required');
        visual.focus();
        window.getSelection()?.collapse(text, text.length);
        pending.hold = true;
        fireEvent.paste(visual, {
          clipboardData: {
            getData: (type: string) => type === 'text/plain' ? 'More' : '',
            types: ['text/plain']
          }
        });
        let expected = `Paragraph 0More${markdown.slice('Paragraph 0'.length)}`;
        await waitFor(() => expect(pending.request?.markdown).toBe(expected));
        expect(visual.getAttribute('data-easymde-preview-refreshing')).toBe('1');
        // Windowed paste intentionally holds the native bridge during transfer.
        expect(session.current?.getValue()).toBe(expected);
        // One user intent; a second click must not be needed after acceptance.
        fireEvent.click(view.getByRole('button', { name: '编辑模式' }));
        expect(view.container.querySelector('.easymde-editor')?.classList.contains('is-immersive-preview')).toBe(true);
        if ('source' !== latestMode && !cancelDuringPreparation) {
          fireEvent.click(view.getByRole('button', {
            name: 'preview' === latestMode ? '预览模式' : '分屏模式'
          }));
        }
        const request = pending.request;
        if (!request) throw new Error('pending-source-formal-request-required');
        preparation.paused = cancelDuringPreparation;
        pending.hold = false;
        await act(async () => {
          held.resolve(responseFor(request));
          await held.promise;
        });
        if (cancelDuringPreparation) {
          await waitFor(() => expect(preparation.started).toBe(true));
          fireEvent.click(view.getByRole('button', {
            name: 'preview' === latestMode ? '预览模式' : '分屏模式'
          }));
          const task = preparation.task;
          if (!task) throw new Error('source-preparation-materialization-task-missing');
          preparation.paused = false;
          await act(async () => {
            preparationGate.resolve();
            await task;
          });
        }
        // Let accepted-Preview effects and already queued layout work settle
        // before checking that a newer view choice cancelled the Source intent.
        await act(async () => {
          await new Promise<void>((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
          });
        });
        await waitFor(() => expect(view.container.querySelector('.easymde-editor')?.classList.contains(`is-immersive-${latestMode}`)).toBe(true));
        if ('preview' !== latestMode) {
          expect(view.container.querySelector('.easymde-source-react .cm-content')).not.toBeNull();
          await waitFor(() => expect(props.submissionField.value).toBe(expected));
        }
        expect(session.current?.getValue()).toBe(expected);
        if (cancelDuringPreparation && 'preview' === latestMode) {
          expect(visual.getAttribute('contenteditable'), 'cancelling Source preparation must not leave the current Preview locked').toBe('true');
          const text = visual.querySelector('p')?.firstChild;
          if (!(text instanceof Text)) throw new Error('cancelled-source-preview-paragraph-missing');
          visual.focus();
          window.getSelection()?.collapse(text, text.length);
          fireEvent.paste(visual, {
            clipboardData: {
              getData: (type: string) => type === 'text/plain' ? 'Again' : '',
              types: ['text/plain']
            }
          });
          expected = `Paragraph 0MoreAgain${markdown.slice('Paragraph 0'.length)}`;
          await waitFor(() => expect(session.current?.getValue()).toBe(expected));
          expect(view.container.querySelector('.easymde-editor')?.classList.contains('is-immersive-preview')).toBe(true);
        }
        expect(props.onFailure).not.toHaveBeenCalled();
        expect(view.container.querySelector('[role="alert"]')).toBeNull();
      } finally {
        preparation.paused = false;
        preparationGate.resolve();
        pending.hold = false;
        if (pending.request) held.resolve(responseFor(pending.request));
        view.unmount();
      }
    }
  );

  it.each([
    ['accepted-exit', 'response-pending'],
    ['accepted-exit', 'enhancing'],
    ['newer-preview-cancels-exit', 'response-pending'],
    ['exit-supersedes-source', 'response-pending'],
    ['teardown-rejects-ABA-completion', 'response-pending']
  ] as const)(
    'pending immersive exit consumer: %s (%s)',
    { timeout: 20_000 },
    async (intent, pendingStage) => {
      const props = fixture();
      // The existing image-scale consumer's native image selection and menu
      // gesture, with parser-valid paragraphs and matching formal line spans.
      const paragraphs = Array.from({ length: 161 }, (_, index) => `Paragraph ${index}`);
      const initial = [
        'Before ![alt](https://example.test/original.png "{width=100%}") after',
        ...paragraphs
      ].join('\n\n');
      const scaled = initial.replace('{width=100%}', '{width=50%}');
      props.submissionField.value = initial;
      props.submissionField.defaultValue = initial;
      props.submissionField.setSelectionRange(0, 0);
      const responseFor = (request: PreviewRequest): PreviewResponse => {
        if (request.markdown !== initial && request.markdown !== scaled) {
          throw new Error('pending-exit-unexpected-source');
        }
        const title = request.markdown === scaled ? '{width=50%}' : '{width=100%}';
        const response = createPreviewResponse(
          request,
          (`<p>Before <img alt="alt" src="https://example.test/original.png" title="${title}"> after</p>`
            + paragraphs.map((text) => `<p>${text}</p>`).join('')) as SafePreviewHtml,
          {}
        );
        if (!response.editMap) throw new Error('pending-exit-edit-map-required');
        return {
          ...response,
          editMap: {
            ...response.editMap,
            blocks: response.editMap.blocks.map((block, index) => ({
              ...block, startLine: 2 * index, endLine: 2 * index + 1
            }))
          }
        };
      };
      // Default spies observe the real session; no runtime or history method
      // is replaced and no test double implements the transition under test.
      const sessions = vi.spyOn(observedSourceAdapter, 'createCodeMirrorDocumentSession');
      const heldResponse = deferred<PreviewResponse>();
      const heldEnhancement = deferred<void>();
      const pending: {
        hold: boolean;
        request: PreviewRequest | null;
        signal: AbortSignal | null;
        enhancement: { isCurrent: () => boolean; signal: AbortSignal } | null;
      } = { hold: false, request: null, signal: null, enhancement: null };
      vi.mocked(props.previewPort.render).mockImplementation((request, signal) => {
        if (pending.hold) {
          pending.request = request;
          pending.signal = signal;
          if ('response-pending' === pendingStage) return heldResponse.promise;
        }
        return Promise.resolve(responseFor(request));
      });
      vi.mocked(props.enhancementPort.enhance).mockImplementation(async (_surface, _features, isCurrent, context) => {
        if (pending.hold && 'enhancing' === pendingStage) {
          pending.enhancement = { isCurrent, signal: context.signal };
          await heldEnhancement.promise;
        }
      });
      const releaseFocusBoundary = vi.fn();
      vi.mocked(props.immersiveEnvironment.activateFocusBoundary).mockReturnValue(releaseFocusBoundary);
      const canonicalInput = vi.fn();
      props.submissionField.addEventListener('input', canonicalInput);
      const view = render(<EditorRoot {...props} editorBlockIndexPort={sourceLinkBlockIndexPort()} />);
      let replacement: typeof view | null = null;
      const settleLayout = async (): Promise<void> => {
        await act(async () => {
          const frame = deferred<void>();
          requestAnimationFrame(() => requestAnimationFrame(() => frame.resolve()));
          await frame.promise;
        });
      };
      const nativeSnapshot = () => ({
        value: props.submissionField.value,
        start: props.submissionField.selectionStart,
        end: props.submissionField.selectionEnd,
        direction: props.submissionField.selectionDirection
      });
      try {
        fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
        fireEvent.click(view.getByRole('button', { name: '预览模式' }));
        const unlock = await view.findByRole('button', { name: '解除锁定并编辑' });
        await waitFor(() => expect(unlock.hasAttribute('disabled')).toBe(false));
        layoutPreviewSurface(view.container);
        fireEvent.click(unlock);
        const visual = await view.findByRole('textbox', { name: '可视化文章编辑器' });
        const creation = sessions.mock.results[0];
        if (!creation || 'return' !== creation.type) throw new Error('pending-exit-document-owner-required');
        const owner = creation.value;
        const currentImage = (): HTMLImageElement => {
          const image = visual.querySelector('img');
          if (!(image instanceof HTMLImageElement)) throw new Error('pending-exit-image-required');
          return image;
        };
        const awaitAccepted = async (value: string, title: string): Promise<void> => {
          await waitFor(() => {
            expect(owner.getValue()).toBe(value);
            expect(visual.getAttribute('data-easymde-preview-phase')).toBe('ready');
            expect(visual.getAttribute('contenteditable')).toBe('true');
            expect(currentImage().getAttribute('title')).toBe(title);
          });
        };
        await awaitAccepted(initial, '{width=100%}');
        expect(visual.querySelector('[data-easymde-preview-window-spacer]')).not.toBeNull();
        expect(owner.getHistoryState()).toEqual({ undoDepth: 0, redoDepth: 0 });
        const openingRevision = owner.getRevision();
        visual.focus();
        const retained = document.createRange();
        retained.selectNode(currentImage());
        const selection = window.getSelection();
        if (!selection) throw new Error('pending-exit-native-selection-required');
        selection.removeAllRanges();
        selection.addRange(retained);
        document.dispatchEvent(new Event('selectionchange'));
        layoutContextMenuSurface(visual);
        fireEvent.contextMenu(currentImage(), { clientX: 24, clientY: 30 });
        const menu = await within(document.body).findByRole('menu');
        const scaleTrigger = within(menu).getByRole('menuitem', { name: 'Image scale' });
        fireEvent.pointerDown(scaleTrigger, { button: 0 });
        fireEvent.click(scaleTrigger);
        const scaleMenu = await within(document.body).findByRole('menu', { name: 'Image scale' });
        const scaleItem = within(scaleMenu).getByRole('menuitem', { name: '50%' });
        fireEvent.pointerDown(scaleItem, { button: 0 });
        fireEvent.click(scaleItem);
        await awaitAccepted(scaled, '{width=50%}');
        expect(owner.getHistoryState()).toEqual({ undoDepth: 1, redoDepth: 0 });
        const pressHistory = (shiftKey = false): void => {
          fireEvent.keyDown(visual, { cancelable: true, ctrlKey: true, key: 'z', shiftKey });
        };
        pressHistory();
        await awaitAccepted(initial, '{width=100%}');
        expect(owner.getHistoryState()).toEqual({ undoDepth: 0, redoDepth: 1 });
        pressHistory(true);
        await awaitAccepted(scaled, '{width=50%}');
        expect(owner.getHistoryState()).toEqual({ undoDepth: 1, redoDepth: 0 });

        // Only the cleanup Undo is held. One exit arrives before this formal
        // transfer settles, never after an await-ready that hides the defect.
        pending.hold = true;
        pressHistory();
        await waitFor(() => expect(pending.request?.markdown).toBe(initial));
        await waitFor(() => expect(visual.getAttribute('data-easymde-preview-phase')).toBe(
          'enhancing' === pendingStage ? 'enhancing' : 'loading'
        ));
        expect(visual.getAttribute('data-easymde-preview-refreshing')).toBe('1');
        const request = pending.request;
        if (!request) throw new Error('pending-exit-formal-request-required');
        expect(request.signature).not.toBe('0:' + initial.length);
        expect(pending.signal?.aborted).toBe(false);
        if ('enhancing' === pendingStage) {
          expect(pending.enhancement?.isCurrent()).toBe(true);
          expect(pending.enhancement?.signal.aborted).toBe(false);
        } else {
          expect(pending.enhancement).toBeNull();
        }
        const beforeExit = {
          value: owner.getValue(), selection: owner.getSelection(),
          revision: owner.getRevision(), history: owner.getHistoryState()
        };
        const nativeBeforeExit = nativeSnapshot();
        const inputsBeforeExit = canonicalInput.mock.calls.length;
        expect(beforeExit.value).toBe(initial);
        expect(beforeExit.revision).toBe(openingRevision + 4);
        expect(beforeExit.history).toEqual({ undoDepth: 0, redoDepth: 1 });
        expect(initial.slice(beforeExit.selection.start, beforeExit.selection.end)).toBe(
          '![alt](https://example.test/original.png "{width=100%}")'
        );
        expect(props.onFailure).not.toHaveBeenCalled();
        if ('exit-supersedes-source' === intent) {
          fireEvent.click(view.getByRole('button', { name: '编辑模式' }));
        }
        fireEvent.click(view.getByRole('button', { name: '退出沉浸写作' }));
        await settleLayout();
        expect(view.queryByRole('region', { name: '沉浸写作' })).not.toBeNull();
        expect(releaseFocusBoundary).not.toHaveBeenCalled();
        const expectNoMutation = (): void => {
          expect({
            value: owner.getValue(), selection: owner.getSelection(),
            revision: owner.getRevision(), history: owner.getHistoryState()
          }).toEqual(beforeExit);
          expect(nativeSnapshot()).toEqual(nativeBeforeExit);
          expect(canonicalInput).toHaveBeenCalledTimes(inputsBeforeExit);
        };
        expectNoMutation();
        if ('newer-preview-cancels-exit' === intent) {
          fireEvent.click(view.getByRole('button', { name: '预览模式' }));
        }
        if ('teardown-rejects-ABA-completion' === intent) {
          view.unmount();
          expect(pending.signal?.aborted).toBe(true);
          expect(releaseFocusBoundary).toHaveBeenCalledOnce();
          const replacementProps = fixture();
          replacementProps.submissionField.value = initial;
          replacementProps.submissionField.defaultValue = initial;
          replacementProps.submissionField.setSelectionRange(0, 0);
          vi.mocked(replacementProps.previewPort.render).mockImplementation((next) => Promise.resolve(responseFor(next)));
          replacement = render(<EditorRoot {...replacementProps} editorBlockIndexPort={sourceLinkBlockIndexPort()} />);
          fireEvent.click(await replacement.findByRole('button', { name: '进入沉浸写作' }));
          fireEvent.click(replacement.getByRole('button', { name: '预览模式' }));
          const replacementUnlock = await replacement.findByRole('button', { name: '解除锁定并编辑' });
          await waitFor(() => expect(replacementUnlock.hasAttribute('disabled')).toBe(false));
          layoutPreviewSurface(replacement.container);
          fireEvent.click(replacementUnlock);
          const replacementVisual = await replacement.findByRole('textbox', { name: '可视化文章编辑器' });
          await waitFor(() => expect(replacementVisual.getAttribute('contenteditable')).toBe('true'));
          const replacementCreation = sessions.mock.results.at(-1);
          if (!replacementCreation || 'return' !== replacementCreation.type) throw new Error('pending-exit-replacement-owner-required');
          const replacementOwner = replacementCreation.value;
          const replacementBefore = {
            value: replacementOwner.getValue(), selection: replacementOwner.getSelection(),
            revision: replacementOwner.getRevision(), history: replacementOwner.getHistoryState(),
            signature: replacementVisual.easymdePreviewSignature
          };
          expect(replacementBefore.value).toBe(beforeExit.value);
          expect(replacementBefore.revision).toBe(0);
          expect(replacementBefore.signature).not.toBe(request.signature);
          pending.hold = false;
          await act(async () => {
            heldResponse.resolve(responseFor(request));
            await heldResponse.promise;
          });
          await settleLayout();
          expect(replacement.queryByRole('region', { name: '沉浸写作' })).not.toBeNull();
          expect({
            value: replacementOwner.getValue(), selection: replacementOwner.getSelection(),
            revision: replacementOwner.getRevision(), history: replacementOwner.getHistoryState(),
            signature: replacementVisual.easymdePreviewSignature
          }).toEqual(replacementBefore);
          expect(replacementVisual.getAttribute('contenteditable')).toBe('true');
          expect(nativeSnapshot()).toEqual(nativeBeforeExit);
          expect(canonicalInput).toHaveBeenCalledTimes(inputsBeforeExit);
          expect(replacementProps.onFailure).not.toHaveBeenCalled();
          return;
        }
        pending.hold = false;
        await act(async () => {
          heldResponse.resolve(responseFor(request));
          heldEnhancement.resolve();
          await heldResponse.promise;
          await heldEnhancement.promise;
        });
        if ('newer-preview-cancels-exit' === intent) {
          await awaitAccepted(initial, '{width=100%}');
          await settleLayout();
          expect(view.queryByRole('region', { name: '沉浸写作' })).not.toBeNull();
          expect(view.container.querySelector('.easymde-editor')?.classList.contains('is-immersive-preview')).toBe(true);
          expect(releaseFocusBoundary).not.toHaveBeenCalled();
        } else {
          await waitFor(() => {
            const immersiveRegion = view.queryByRole('region', { name: '沉浸写作' });
            if (immersiveRegion) {
              // A RED exit assertion requires accepted cleanup-Undo content,
              // not just a resolved promise or an old ready phase. A prior
              // Source request may legitimately refresh the same source again.
              expect(visual.getAttribute('data-easymde-preview-phase')).toBe('ready');
              if ('exit-supersedes-source' !== intent) {
                expect(visual.easymdePreviewSignature).toBe(request.signature);
              }
              expect(currentImage().getAttribute('title')).toBe('{width=100%}');
              expectNoMutation();
              expect(props.onFailure).not.toHaveBeenCalled();
            }
            expect(
              immersiveRegion,
              'one pending exit must complete after the accepted image-history transfer without another click'
            ).toBeNull();
          });
          await settleLayout();
          expect(view.container.querySelector('.easymde-editor')?.classList.contains('is-immersive')).toBe(false);
          expect(view.container.querySelector('.easymde-source-react .cm-content')).not.toBeNull();
          expect(releaseFocusBoundary).toHaveBeenCalledOnce();
        }
        expectNoMutation();
        expect(props.onFailure).not.toHaveBeenCalled();
        expect(view.container.querySelector('[role="alert"]')).toBeNull();
      } finally {
        pending.hold = false;
        heldEnhancement.resolve();
        if (pending.request) heldResponse.resolve(responseFor(pending.request));
        props.submissionField.removeEventListener('input', canonicalInput);
        replacement?.unmount();
        view.unmount();
      }
    }
  );

  it('safely exits one pending visual transfer when full materialization is unavailable without another render', { timeout: 20_000 }, async () => {
    const props = fixture();
    const paragraphs = Array.from({ length: 161 }, (_, index) => `Paragraph ${index}`);
    const initial = [
      'Before ![alt](https://example.test/original.png "{width=100%}") after',
      ...paragraphs
    ].join('\n\n');
    const scaled = initial.replace('{width=100%}', '{width=50%}');
    props.submissionField.value = initial;
    props.submissionField.defaultValue = initial;
    props.submissionField.setSelectionRange(0, 0);
    const responseFor = (request: PreviewRequest): PreviewResponse => {
      if (request.markdown !== initial && request.markdown !== scaled) {
        throw new Error('pending-exit-materialization-unexpected-source');
      }
      const title = request.markdown === scaled ? '{width=50%}' : '{width=100%}';
      const response = createPreviewResponse(
        request,
        (`<p>Before <img alt="alt" src="https://example.test/original.png" title="${title}"> after</p>`
          + paragraphs.map((text) => `<p>${text}</p>`).join('')) as SafePreviewHtml,
        {}
      );
      if (!response.editMap) throw new Error('pending-exit-materialization-edit-map-required');
      return {
        ...response,
        editMap: {
          ...response.editMap,
          blocks: response.editMap.blocks.map((block, index) => ({
            ...block, startLine: 2 * index, endLine: 2 * index + 1
          }))
        }
      };
    };
    const sessions = vi.spyOn(observedSourceAdapter, 'createCodeMirrorDocumentSession');
    const held = deferred<PreviewResponse>();
    const pending: { request: PreviewRequest | null; signal: AbortSignal | null; hold: boolean } = {
      request: null, signal: null, hold: false
    };
    vi.mocked(props.previewPort.render).mockImplementation((request, signal) => {
      if (pending.hold) {
        pending.request = request;
        pending.signal = signal;
        return held.promise;
      }
      return Promise.resolve(responseFor(request));
    });
    const observed: {
      runtime: observedPreviewOwner.PreviewSurfaceRuntime | null;
      materialization: { results: ReadonlyArray<{ type: string; value?: unknown }> } | null;
      armed: boolean;
      schedulerRejections: number;
      rejectedAcceptedSignature: string | null;
      rejectedPhase: string | null;
    } = {
      runtime: null, materialization: null, armed: false,
      schedulerRejections: 0, rejectedAcceptedSignature: null, rejectedPhase: null
    };
    // Reuse the real staged-materialization rejection boundary exercised by
    // the existing second-windowed-unlock consumer; never replace materialize.
    const materializeScheduler = { yield: async () => {
      if (!observed.armed) return;
      observed.schedulerRejections += 1;
      if (1 === observed.schedulerRejections) {
        observed.rejectedAcceptedSignature = observed.runtime?.surface.easymdePreviewSignature ?? null;
        observed.rejectedPhase = observed.runtime?.surface.getAttribute('data-easymde-preview-phase') ?? null;
      }
      throw new Error('synthetic-materialization-failure');
    } };
    const stagingScheduler = { now: () => 0, yield: () => Promise.resolve() };
    const realPreviewOwner = observedPreviewOwner.PreviewSurfaceOwner;
    vi.spyOn(observedPreviewOwner, 'PreviewSurfaceOwner').mockImplementation((componentProps) => {
      const onReady = observedCallback((runtime: observedPreviewOwner.PreviewSurfaceRuntime) => {
        if (observed.runtime !== runtime) {
          observed.runtime = runtime;
          observed.materialization = vi.spyOn(runtime, 'materialize').mock;
        }
        componentProps.onReady(runtime);
      }, [componentProps.onReady]);
      return realPreviewOwner({ ...componentProps, onReady, materializeScheduler, stagingScheduler });
    });
    const releaseFocusBoundary = vi.fn();
    vi.mocked(props.immersiveEnvironment.activateFocusBoundary).mockReturnValue(releaseFocusBoundary);
    const canonicalInput = vi.fn();
    props.submissionField.addEventListener('input', canonicalInput);
    const view = render(<EditorRoot {...props} editorBlockIndexPort={sourceLinkBlockIndexPort()} />);
    try {
      fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
      fireEvent.click(view.getByRole('button', { name: '预览模式' }));
      const unlock = await view.findByRole('button', { name: '解除锁定并编辑' });
      await waitFor(() => expect(unlock.hasAttribute('disabled')).toBe(false));
      layoutPreviewSurface(view.container);
      fireEvent.click(unlock);
      const visual = await view.findByRole('textbox', { name: '可视化文章编辑器' });
      await waitFor(() => {
        expect(visual.getAttribute('contenteditable')).toBe('true');
        expect(visual.getAttribute('data-easymde-preview-phase')).toBe('ready');
      });
      expect(visual.querySelector('[data-easymde-preview-window-spacer]')).not.toBeNull();
      const creation = sessions.mock.results[0];
      if (!creation || 'return' !== creation.type) throw new Error('pending-exit-materialization-document-required');
      const owner = creation.value;
      const image = visual.querySelector('img');
      if (!(image instanceof HTMLImageElement)) throw new Error('pending-exit-materialization-image-required');
      visual.focus();
      const retained = document.createRange();
      retained.selectNode(image);
      const selection = window.getSelection();
      if (!selection) throw new Error('pending-exit-materialization-native-selection-required');
      selection.removeAllRanges();
      selection.addRange(retained);
      document.dispatchEvent(new Event('selectionchange'));
      layoutContextMenuSurface(visual);
      fireEvent.contextMenu(image, { clientX: 24, clientY: 30 });
      const menu = await within(document.body).findByRole('menu');
      const scaleTrigger = within(menu).getByRole('menuitem', { name: 'Image scale' });
      fireEvent.pointerDown(scaleTrigger, { button: 0 });
      fireEvent.click(scaleTrigger);
      const scaleMenu = await within(document.body).findByRole('menu', { name: 'Image scale' });
      const scaleItem = within(scaleMenu).getByRole('menuitem', { name: '50%' });
      pending.hold = true;
      fireEvent.pointerDown(scaleItem, { button: 0 });
      fireEvent.click(scaleItem);
      await waitFor(() => expect(pending.request?.markdown).toBe(scaled));
      expect(pending.signal?.aborted).toBe(false);
      expect(visual.getAttribute('data-easymde-preview-refreshing')).toBe('1');
      const request = pending.request;
      if (!request) throw new Error('pending-exit-materialization-formal-request-required');
      const beforeExit = {
        value: owner.getValue(), selection: owner.getSelection(),
        revision: owner.getRevision(), history: owner.getHistoryState(),
        nativeValue: props.submissionField.value,
        nativeSelection: [props.submissionField.selectionStart, props.submissionField.selectionEnd, props.submissionField.selectionDirection]
      };
      expect(beforeExit.value).toBe(scaled);
      expect(beforeExit.history).toEqual({ undoDepth: 1, redoDepth: 0 });
      expect(scaled.slice(beforeExit.selection.start, beforeExit.selection.end)).toBe(
        '![alt](https://example.test/original.png "{width=50%}")'
      );
      const inputsBeforeExit = canonicalInput.mock.calls.length;
      const rendersBeforeAcceptance = vi.mocked(props.previewPort.render).mock.calls.length;
      const expectNoMutation = (): void => {
        expect({
          value: owner.getValue(), selection: owner.getSelection(),
          revision: owner.getRevision(), history: owner.getHistoryState(),
          nativeValue: props.submissionField.value,
          nativeSelection: [props.submissionField.selectionStart, props.submissionField.selectionEnd, props.submissionField.selectionDirection]
        }).toEqual(beforeExit);
        expect(canonicalInput).toHaveBeenCalledTimes(inputsBeforeExit);
      };
      fireEvent.click(view.getByRole('button', { name: '退出沉浸写作' }));
      expect(view.queryByRole('region', { name: '沉浸写作' })).not.toBeNull();
      expect(releaseFocusBoundary).not.toHaveBeenCalled();
      expectNoMutation();
      expect(props.onFailure).not.toHaveBeenCalled();
      observed.armed = true;
      pending.hold = false;
      await act(async () => {
        held.resolve(responseFor(request));
        await held.promise;
      });
      await waitFor(async () => {
        const immersiveRegion = view.queryByRole('region', { name: '沉浸写作' });
        let materializeOutcome: unknown = 'not-requested';
        if (immersiveRegion) {
          // A pre-fix RED must reach the actual scheduler rejection and real
          // materialize(false) result, not fail on a fixture/phase prerequisite.
          const result = observed.materialization?.results[0];
          expect(result?.type).toBe('return');
          materializeOutcome = await result?.value;
          expect(materializeOutcome).toBe(false);
          expect(observed.schedulerRejections).toBeGreaterThan(0);
          expect(observed.rejectedAcceptedSignature).toBe(request.signature);
          expect(observed.rejectedPhase).toBe('ready');
          expectNoMutation();
        }
        expect(immersiveRegion,
          'one deferred exit must return to the ordinary editor even when real full materialization fails: '
            + JSON.stringify({
              materializeOutcome, schedulerRejections: observed.schedulerRejections,
              rejectedPhase: observed.rejectedPhase,
              rejectedAcceptedSignature: observed.rejectedAcceptedSignature,
              phase: visual.getAttribute('data-easymde-preview-phase'),
              failures: vi.mocked(props.onFailure).mock.calls
            })
        ).toBeNull();
      });
      await act(async () => {
        const frame = deferred<void>();
        requestAnimationFrame(() => requestAnimationFrame(() => frame.resolve()));
        await frame.promise;
      });
      expect(view.container.querySelector('.easymde-editor')?.classList.contains('is-immersive')).toBe(false);
      expect(view.container.querySelector('.easymde-source-react .cm-content')).not.toBeNull();
      expectNoMutation();
      expect(props.previewPort.render).toHaveBeenCalledTimes(rendersBeforeAcceptance);
      expect(releaseFocusBoundary).toHaveBeenCalledOnce();
    } finally {
      observed.armed = false;
      pending.hold = false;
      if (pending.request) held.resolve(responseFor(pending.request));
      props.submissionField.removeEventListener('input', canonicalInput);
      view.unmount();
    }
  });

  it.each([
    ['编辑', '预览', 'source', 'ready'],
    ['编辑模式', '预览模式', 'source', 'ready'],
    ['分屏', '预览', 'split', 'ready'],
    ['分屏模式', '预览模式', 'split', 'ready'],
    ['编辑', '预览', 'source', 'complete'],
    ['编辑', '预览', 'source', 'fail']
  ] as const)(
    'settles a second windowed unlock after %s → %s (%s, %s materialization)',
    { timeout: 10_000 },
    async (modeControl, previewControl, mode, materialization) => {
      const props = fixture();
      const lines = Array.from({ length: 200 }, (_, index) => `Paragraph ${index}`);
      const markdown = lines.join('\n');
      props.submissionField.value = markdown;
      props.submissionField.defaultValue = markdown;
      props.submissionField.setSelectionRange(0, 0);
      vi.mocked(props.previewPort.render).mockImplementation((request) =>
        Promise.resolve(createPreviewResponse(
          request,
          lines.map((line) => `<p>${line}</p>`).join('') as SafePreviewHtml,
          {}
        ))
      );
      const realPreviewOwner = observedPreviewOwner.PreviewSurfaceOwner;
      const previewRuntimeRef: {
        current: observedPreviewOwner.PreviewSurfaceRuntime | null;
      } = { current: null };
      let windowed = false;
      const acceptedWindows: Array<{ revision: number; signature: string }> = [];
      const stagingScheduler = { now: () => 0, yield: () => Promise.resolve() };
      let pauseMaterialization = false;
      const materializationSteps: Array<{
        resolve: () => void;
        reject: (reason: Error) => void;
      }> = [];
      const materializeScheduler = {
        yield: () => {
          if (!pauseMaterialization) return Promise.resolve();
          const next = deferred<void>();
          materializationSteps.push(next);
          return next.promise;
        }
      };
      vi.spyOn(observedPreviewOwner, 'PreviewSurfaceOwner').mockImplementation(
        (componentProps) => {
          windowed = Boolean(componentProps.windowed);
          const onReady = observedCallback(
            (runtime: observedPreviewOwner.PreviewSurfaceRuntime) => {
              previewRuntimeRef.current = runtime;
              componentProps.onReady(runtime);
            },
            [componentProps.onReady]
          );
          const onWindowReady = observedCallback(() => {
            const accepted = previewRuntimeRef.current?.getAcceptedWindowSnapshot();
            if (accepted) acceptedWindows.push(accepted);
            componentProps.onWindowReady?.();
          }, [componentProps.onWindowReady]);
          return realPreviewOwner({
            ...componentProps, onReady, onWindowReady, stagingScheduler,
            materializeScheduler
          });
        }
      );
      const view = render(<EditorRoot {...props} />);
      fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
      fireEvent.click(view.getByRole('button', { name: previewControl }));
      const unlock = view.getByRole('button', { name: '解除锁定并编辑' });
      await waitFor(() => expect(unlock.hasAttribute('disabled')).toBe(false));
      layoutPreviewSurface(view.container);
      fireEvent.click(unlock);
      const visual = await view.findByRole('textbox', { name: '可视化文章编辑器' });
      await waitFor(() => expect(document.activeElement).toBe(visual));
      expect(unlock.getAttribute('aria-busy')).toBeNull();
      expect(visual.getAttribute('contenteditable')).toBe('true');
      expect(visual.querySelector('[data-easymde-preview-window-spacer]')).not.toBeNull();
      expect(visual.querySelectorAll('[data-easymde-visual-block-id]').length)
        .toBeLessThanOrEqual(DEFAULT_PREVIEW_WINDOW_MAX_MOUNTED);
      expect(acceptedWindows.at(-1)).toMatchObject({ revision: 2 });

      fireEvent.click(view.getByRole('button', { name: modeControl }));
      await waitFor(() => expect(view.container.querySelector('.easymde-editor')
        ?.classList.contains(`is-immersive-${mode}`)).toBe(true));
      await waitFor(() => expect(props.previewPort.render).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(visual.easymdePreviewSignature)
        .toBe(vi.mocked(props.previewPort.render).mock.calls[1]?.[0].signature));
      expect(visual.getAttribute('contenteditable')).toBeNull();
      pauseMaterialization = 'ready' !== materialization;
      fireEvent.click(view.getByRole('button', { name: previewControl }));
      const secondUnlock = view.getByRole('button', { name: '解除锁定并编辑' });
      await waitFor(() => expect(secondUnlock.hasAttribute('disabled')).toBe(false));
      if ('ready' === materialization) {
        await waitFor(() => expect(visual.querySelectorAll('[data-easymde-visual-block-id]'))
          .toHaveLength(lines.length));
      } else {
        await waitFor(() => expect(materializationSteps.length).toBeGreaterThan(0));
      }
      expect(windowed).toBe(false);
      expect(previewRuntimeRef.current?.getAcceptedWindowSnapshot()).toBeNull();
      const windowReadyCount = acceptedWindows.length;
      expect(secondUnlock.getAttribute('aria-busy')).toBeNull();

      fireEvent.click(secondUnlock);
      // Prove the click was admitted, rather than swallowed by a stale busy guard.
      expect(secondUnlock.getAttribute('aria-busy')).toBe('true');
      // The Root's async preparation must also admit the window request.
      await waitFor(() => expect(windowed).toBe(true));
      if ('ready' !== materialization) {
        expect(secondUnlock.getAttribute('aria-busy')).toBe('true');
        expect(visual.getAttribute('contenteditable')).not.toBe('true');
        expect(acceptedWindows).toHaveLength(windowReadyCount);
        for (let index = 0; index < 32; index += 1) {
          const next = materializationSteps.shift();
          if (!next) break;
          await act(async () => {
            if ('fail' === materialization) {
              next.reject(new Error('synthetic-materialization-failure'));
            } else {
              next.resolve();
            }
            for (let turn = 0; turn < 16; turn += 1) await Promise.resolve();
          });
        }
        expect(materializationSteps).toHaveLength(0);
      }
      await waitFor(() => expect(secondUnlock.getAttribute('aria-busy')).toBeNull());
      if ('fail' === materialization) {
        expect(props.onFailure).toHaveBeenCalledWith('preview-enhancement-failed');
        expect(view.getByText('Failed', { selector: '[role="alert"]' })).toBeTruthy();
        expect(visual.getAttribute('contenteditable')).not.toBe('true');
        expect(previewRuntimeRef.current?.getAcceptedWindowSnapshot()).toBeNull();
        expect(acceptedWindows).toHaveLength(windowReadyCount);
        expect(view.getByRole('button', { name: modeControl }).hasAttribute('disabled'))
          .toBe(false);
        fireEvent.click(view.getByRole('button', { name: modeControl }));
        await waitFor(() => expect(view.container.querySelector('.easymde-editor')
          ?.classList.contains('is-immersive-source')).toBe(true));
        expect(props.submissionField.value).toBe(markdown);
        view.unmount();
        return;
      }
      expect(view.getByRole('textbox', { name: '可视化文章编辑器' })).toBe(visual);
      expect(visual.getAttribute('contenteditable')).toBe('true');
      await waitFor(() => expect(document.activeElement).toBe(visual));
      expect(visual.querySelectorAll('[data-easymde-visual-block-id]').length)
        .toBeLessThanOrEqual(DEFAULT_PREVIEW_WINDOW_MAX_MOUNTED);
      expect(acceptedWindows.length).toBeGreaterThan(windowReadyCount);
      expect(acceptedWindows.at(-1)).toMatchObject({
        revision: 4,
        signature: vi.mocked(props.previewPort.render).mock.calls[1]?.[0].signature
      });
      expect(props.submissionField.value).toBe(markdown);
      expect(props.onFailure).not.toHaveBeenCalled();
      view.unmount();
    }
  );

  it('keeps a large Preview ready through text and icon mode round trips before first unlock', { timeout: 20_000 }, async () => {
    const props = fixture();
    const realCreateDocumentSession =
      observedSourceAdapter.createCodeMirrorDocumentSession;
    const documentOwnerRef: {
      current: CodeMirrorDocumentSession | null;
    } = { current: null };
    vi.spyOn(observedSourceAdapter, 'createCodeMirrorDocumentSession')
      .mockImplementation((options) => {
        const owner = realCreateDocumentSession(options);
        documentOwnerRef.current = owner;
        return owner;
      });
    const blockCount = 640;
    const sourceBlocks = Array.from({ length: blockCount }, (_, index) => {
      if (3 === index) {
        return {
          markdown: ['![Pic](https://img.test/pic.png)'],
          html: '<p><img src="https://img.test/pic.png" alt="Pic"></p>'
        };
      }
      if (5 === index) {
        return {
          markdown: ['```js', 'const value = 1;', '```'],
          html: '<pre><code>const value = 1;</code></pre>'
        };
      }
      if (7 === index) {
        return {
          markdown: ['Inline $x$ math'],
          html:
            '<p>Inline <span class="easymde-math easymde-math-inline">' +
            '<span>2</span></span> math</p>'
        };
      }
      return {
        markdown: [`Paragraph ${index}`],
        html: `<p>Paragraph ${index}</p>`
      };
    });
    const markdown = sourceBlocks.flatMap(({ markdown: lines }) => lines).join('\n');
    const rendered = sourceBlocks.map(({ html }) => html).join('');
    props.submissionField.value = markdown;
    props.submissionField.defaultValue = markdown;
    props.submissionField.setSelectionRange(0, 0);
    const cumulativePreviewResponse = (request: PreviewRequest): PreviewResponse => {
      const response = createPreviewResponse(request, rendered as SafePreviewHtml, {});
      if (!response.editMap) throw new Error('large-preview-edit-map-missing');
      let startLine = 0;
      const blocks = response.editMap.blocks.map((block, index) => {
        const lineCount = sourceBlocks[index]?.markdown.length ?? 1;
        const endLine = startLine + lineCount;
        const mapped = { ...block, endLine, startLine };
        startLine = endLine;
        return mapped;
      });
      if (startLine !== request.markdown.split(/\r\n|\r|\n/).length) {
        throw new Error('large-preview-edit-map-line-span-invalid');
      }
      return { ...response, editMap: { ...response.editMap, blocks } };
    };
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      Promise.resolve(cumulativePreviewResponse(request))
    );
    const realPreviewOwner = observedPreviewOwner.PreviewSurfaceOwner;
    const stagingScheduler = { now: () => 0, yield: () => Promise.resolve() };
    const materializeScheduler = { yield: () => Promise.resolve() };
    vi.spyOn(observedPreviewOwner, 'PreviewSurfaceOwner').mockImplementation(
      (componentProps) => {
        return realPreviewOwner({
          ...componentProps,
          stagingScheduler,
          materializeScheduler
        });
      }
    );
    const view = render(<EditorRoot {...props} />);
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    const sink = view.container.querySelector<HTMLElement>(
      '[data-easymde-preview-html-sink="1"]'
    );
    if (!sink) throw new Error('large-preview-sink-missing');
    await waitFor(
      () => {
        const phase = sink.getAttribute('data-easymde-preview-phase');
        if ('ready' !== phase) {
          throw new Error(
            `large-preview-phase=${phase} failures=${JSON.stringify(
              vi.mocked(props.onFailure).mock.calls
            )}`
          );
        }
      },
      { timeout: 8000 }
    );
    layoutPreviewSurface(view.container);
    const owner = documentOwnerRef.current;
    if (!owner) throw new Error('large-preview-owner-missing');
    const baselineSource = owner.getValue();
    const baselineRevision = owner.getRevision?.();
    const baselineHistory = owner.getHistoryState();
    const baselineRenderCalls = vi.mocked(props.previewPort.render).mock.calls.length;
    const blocks = (): number =>
      sink.querySelectorAll('[data-easymde-visual-block-id]').length;
    const spacers = (): number =>
      sink.querySelectorAll('[data-easymde-preview-window-spacer]').length;
    const mountedIds = (): Array<string> =>
      Array.from(
        sink.querySelectorAll<HTMLElement>('[data-easymde-visual-block-id]')
      ).map((node) => node.getAttribute('data-easymde-visual-block-id') ?? '');
    const spacerRange = (): Readonly<{ end: number; start: number }> => {
      const spacer = sink.querySelector<HTMLElement>(
        '[data-easymde-preview-window-spacer]'
      );
      if (!spacer) throw new Error('preview-window-spacer-missing');
      const start = Number.parseInt(
        spacer.getAttribute('data-easymde-preview-window-start') ?? '',
        10
      );
      const end = Number.parseInt(
        spacer.getAttribute('data-easymde-preview-window-end') ?? '',
        10
      );
      if (!Number.isInteger(start) || !Number.isInteger(end)) {
        throw new Error('preview-window-spacer-range-invalid');
      }
      return { end, start };
    };
    const lastMountedIndex = (): number => {
      const index = Number.parseInt(
        mountedIds().at(-1)?.replace(/^b/u, '') ?? '',
        10
      );
      if (!Number.isInteger(index)) {
        throw new Error('preview-window-mounted-index-invalid');
      }
      return index;
    };
    const settled = (): Readonly<{ failures: unknown; phase: string | null }> => ({
      failures: vi.mocked(props.onFailure).mock.calls,
      phase: sink.getAttribute('data-easymde-preview-phase')
    });
    const settleVisible = async (): Promise<void> => {
      await waitFor(
        () => {
          expect(spacers()).toBe(0);
          expect(blocks()).toBe(blockCount);
        },
        { timeout: 8000 }
      );
      expect(settled()).toEqual({ failures: [], phase: 'ready' });
      expect(view.container.querySelector('[role="alert"]')).toBeNull();
    };
    const settleHiddenWindow = async (): Promise<void> => {
      await waitFor(() => expect(spacers()).toBeGreaterThan(0), {
        timeout: 8000
      });
      expect(blocks()).toBeLessThanOrEqual(DEFAULT_PREVIEW_WINDOW_MAX_MOUNTED);
      // The installed window's spacer must declare exactly the range it covers.
      expect(spacerRange()).toEqual({
        end: blockCount,
        start: lastMountedIndex() + 1
      });
      expect(settled()).toEqual({ failures: [], phase: 'ready' });
      expect(view.container.querySelector('[role="alert"]')).toBeNull();
    };
    const clickMode = async (
      name: string,
      settle: () => Promise<void>
    ): Promise<void> => {
      fireEvent.click(view.getByRole('button', { name }));
      await settle();
      expect(sink).toBe(
        view.container.querySelector('[data-easymde-preview-html-sink="1"]')
      );
      expect(owner.getValue()).toBe(baselineSource);
      expect(owner.getRevision?.()).toBe(baselineRevision);
      expect(owner.getHistoryState()).toEqual(baselineHistory);
      expect(vi.mocked(props.previewPort.render).mock.calls.length).toBe(
        baselineRenderCalls
      );
    };

    await settleVisible();
    // The exact browser round trip: text 编辑 → 预览, icon 预览模式 → 编辑模式
    // → 分屏模式, text 分屏 → 编辑 → 预览, icon 预览模式.
    await clickMode('编辑', settleHiddenWindow);
    await clickMode('预览', settleVisible);
    await clickMode('预览模式', settleVisible);
    await clickMode('编辑模式', settleHiddenWindow);
    await clickMode('分屏模式', settleVisible);
    await clickMode('分屏', settleVisible);
    await clickMode('编辑', settleHiddenWindow);
    await clickMode('预览', settleVisible);
    await clickMode('预览模式', settleVisible);

    expect(props.onFailure).not.toHaveBeenCalled();
    expect(view.getByRole('button', { name: '解除锁定并编辑' })
      .hasAttribute('disabled')).toBe(false);
    view.unmount();
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
    await waitFor(() => expect(props.submissionField.value).toBe('\\~\\~\\~'));
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
    layoutPreviewSurface(view.container);
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

    const paragraphText = visualEditor.querySelector('p')?.firstChild;
    if (!(paragraphText instanceof Text)) throw new Error('publish-pending-native-text-missing');
    visualEditor.focus();
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(paragraphText);
    selection?.removeAllRanges();
    selection?.addRange(range);
    const before = new InputEvent('beforeinput', {
      bubbles: true, cancelable: true, data: edited,
      inputType: 'insertReplacementText'
    });
    Object.defineProperty(before, 'getTargetRanges', {
      value: () => [{ startContainer: paragraphText, startOffset: 0,
        endContainer: paragraphText, endOffset: paragraphText.length }]
    });
    visualEditor.dispatchEvent(before);
    expect(before.defaultPrevented).toBe(false);
    paragraphText.replaceData(0, paragraphText.length, edited);
    selection?.collapse(paragraphText, paragraphText.length);
    visualEditor.dispatchEvent(new InputEvent('input', {
      bubbles: true, data: edited, inputType: 'insertReplacementText'
    }));
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

  it('fails a Source media insertion when the field became read-only while the picker was open', async () => {
    // The media picker is a user gesture that can stay open indefinitely, so the
    // authoritative Source field may turn read-only before the user selects an
    // attachment. The insertion must then fail explicitly and write neither the
    // canonical document nor history.
    const props = fixture();
    props.submissionField.value = 'Before after';
    props.submissionField.defaultValue = 'Before after';
    props.submissionField.setSelectionRange(7, 7);
    const before = props.submissionField.value;
    const view = render(<EditorRoot {...props} />);
    try {
      fireEvent.click(view.getByRole('button', { name: 'Image' }));
      fireEvent.click(view.getByRole('button', { name: 'Image' }));
      const frame = props.mediaPickerFrame;
      if (!frame) throw new Error('media-frame-missing');
      const open = vi.mocked(frame.open).mock.calls[0]?.[0];
      if (!open) throw new Error('media-frame-open-missing');
      // The picker was opened while editable; the field turns read-only now.
      props.submissionField.readOnly = true;
      open.onSelect({
        alt: 'Selected image',
        url: 'https://example.test/readonly.png'
      });
      open.onClose();
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(props.submissionField.value).toBe(before);
      expect(props.submissionField.value).not.toContain('readonly.png');
      expect(props.onFailure).toHaveBeenCalledWith(
        'media-picker-document-read-only'
      );
    } finally {
      props.submissionField.readOnly = false;
      view.unmount();
    }
  });

  it('fails a Source media insertion when the field became disabled while the picker was open', async () => {
    // The authoritative field can also be disabled rather than read-only. The
    // adapter reads both, so the mutation must reject either transition without
    // touching the canonical document or history.
    const props = fixture();
    props.submissionField.value = 'Before after';
    props.submissionField.defaultValue = 'Before after';
    props.submissionField.setSelectionRange(7, 7);
    const before = props.submissionField.value;
    const view = render(<EditorRoot {...props} />);
    try {
      fireEvent.click(view.getByRole('button', { name: 'Image' }));
      fireEvent.click(view.getByRole('button', { name: 'Image' }));
      const frame = props.mediaPickerFrame;
      if (!frame) throw new Error('media-frame-missing');
      const open = vi.mocked(frame.open).mock.calls[0]?.[0];
      if (!open) throw new Error('media-frame-open-missing');
      props.submissionField.disabled = true;
      open.onSelect({
        alt: 'Selected image',
        url: 'https://example.test/disabled.png'
      });
      open.onClose();
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(props.submissionField.value).toBe(before);
      expect(props.submissionField.value).not.toContain('disabled.png');
      expect(props.onFailure).toHaveBeenCalledWith(
        'media-picker-document-read-only'
      );
    } finally {
      props.submissionField.disabled = false;
      view.unmount();
    }
  });

  it.each([
    ['readOnly', 'above'],
    ['readOnly', 'below'],
    ['disabled', 'above'],
    ['disabled', 'below']
  ] as const)(
    'rejects formatted Source context media insertion after %s permission loss in position %s without changing history',
    async (flag, direction) => {
      // The picker opens while the field is editable, so the formatted
      // context-menu insertion (Insert -> image above / below) is genuinely
      // enabled on the relative-insertion branch. The authoritative native flag
      // then changes before confirmation: the mutation itself must reject, keep
      // the exact source and selection, and leave no history entry or deferred
      // insertion behind.
      const props = fixture();
      const initial = 'Before after\n\nTail';
      props.submissionField.value = initial;
      props.submissionField.defaultValue = initial;
      const caret = initial.indexOf('after');
      props.submissionField.setSelectionRange(caret, caret);
      const realCreateDocumentSession =
        observedSourceAdapter.createCodeMirrorDocumentSession;
      const documentOwnerRef: {
        current: ReturnType<typeof realCreateDocumentSession> | null;
      } = { current: null };
      vi.spyOn(observedSourceAdapter, 'createCodeMirrorDocumentSession')
        .mockImplementation((options) => {
          const owner = realCreateDocumentSession(options);
          documentOwnerRef.current = owner;
          return owner;
        });
      const view = render(
        <EditorRoot {...props} editorBlockIndexPort={sourceLinkBlockIndexPort()} />
      );
      try {
        const source = await waitFor(() => {
          const element = view.container.querySelector<HTMLElement>('.cm-content');
          if (!element) throw new Error('source-surface-missing');
          return element;
        });
        const owner = documentOwnerRef.current;
        if (!owner) throw new Error('source-document-owner-missing');
        layoutContextMenuSurface(source);
        fireEvent.contextMenu(source, { clientX: 20, clientY: 24 });
        await within(document.body).findByRole('menu');
        fireEvent.click(
          within(document.body).getByRole('menuitem', { name: 'Insert' })
        );
        const relativeInsert = await within(document.body).findByRole('menuitem', {
          name: `Insert image ${direction}`
        });
        expect(relativeInsert.getAttribute('aria-disabled')).toBe('false');
        fireEvent.click(relativeInsert);

        const frame = props.mediaPickerFrame;
        if (!frame) throw new Error('media-frame-missing');
        const open = vi.mocked(frame.open).mock.calls.at(-1)?.[0];
        if (!open) throw new Error('media-frame-open-missing');
        // Everything is still editable while the user works in the picker.
        const beforeSource = owner.getValue();
        const beforeSelection = owner.getSelection();
        const beforeHistory = owner.getHistoryState();
        const beforeRevision = owner.getRevision?.();

        // Only the authoritative native field changes, immediately before the
        // real confirmation.
        if ('readOnly' === flag) props.submissionField.readOnly = true;
        else props.submissionField.disabled = true;
        // Read the authoritative native field back: exactly the selected flag
        // changed, while the other one still permits nothing extra.
        expect(props.submissionField.readOnly).toBe('readOnly' === flag);
        expect(props.submissionField.disabled).toBe('disabled' === flag);

        open.onSelect({
          alt: 'Selected image',
          url: `https://example.test/${flag}.png`
        });
        open.onClose();

        await waitFor(() =>
          expect(props.onFailure).toHaveBeenCalledWith(
            'media-picker-document-read-only'
          )
        );
        // Exactly one stable failure: not the generic fallback, no duplicate.
        expect(
          vi.mocked(props.onFailure).mock.calls.filter(
            (call) => call[0].startsWith('media-picker-')
          )
        ).toEqual([['media-picker-document-read-only']]);
        expect(view.getByRole('alert').textContent).toBe(
          'The media library could not be opened.'
        );
        // Byte-identical source, identical native and canonical selection,
        // identical revision and history: the failed insertion wrote nothing.
        expect(owner.getValue()).toBe(beforeSource);
        expect(props.submissionField.value).toBe(initial);
        // The authoritative native field keeps the user's own caret exactly:
        // a rejected insertion never moves the native selection either.
        expect([
          props.submissionField.selectionStart,
          props.submissionField.selectionEnd
        ]).toEqual([caret, caret]);
        expect(owner.getSelection()).toEqual(beforeSelection);
        expect(owner.getHistoryState()).toEqual(beforeHistory);
        expect(owner.getRevision?.()).toBe(beforeRevision);
        expect(props.submissionField.value).not.toContain(`${flag}.png`);
        expect(source.querySelector('img')).toBeNull();

        // Restore the exact original flag and prove no insertion is deferred.
        props.submissionField.readOnly = false;
        props.submissionField.disabled = false;
        await act(async () => {
          await Promise.resolve();
          await Promise.resolve();
        });
        expect(owner.getValue()).toBe(initial);
        expect(owner.getSelection()).toEqual(beforeSelection);
        expect(owner.getHistoryState()).toEqual(beforeHistory);
        expect(source.querySelector('img')).toBeNull();
        expect(view.queryByRole('dialog')).toBeNull();
      } finally {
        props.submissionField.readOnly = false;
        props.submissionField.disabled = false;
        view.unmount();
      }
    }
  );

  it('keeps a keyboard context-menu demand on the block the user selected, then dismisses it by Escape', async () => {
    // A truthful two-block document: Lead is line 0, Tail is line 2. The map
    // names both blocks, so a demand that silently described Lead would be
    // observable instead of passing on a single-child fixture.
    const props = fixture();
    const initial = 'Lead\n\nTail';
    props.submissionField.value = initial;
    props.submissionField.defaultValue = initial;
    props.submissionField.setSelectionRange(0, 0);
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      Promise.resolve({
        editMap: {
          blocks: [
            { editable: true, endLine: 1, id: 'b0', startLine: 0 },
            { editable: true, endLine: 3, id: 'b1', startLine: 2 }
          ],
          coordinate: 'line' as const,
          signature: request.signature,
          version: 1 as const
        },
        features: {},
        html: (
          '<p data-easymde-visual-block-id="b0">Lead</p>'
          + '<p data-easymde-visual-block-id="b1">Tail</p>'
        ) as SafePreviewHtml
      })
    );
    const view = render(<EditorRoot {...props} />);
    try {
      fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
      fireEvent.click(view.getByRole('button', { name: '预览' }));
      await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
      layoutPreviewSurface(view.container);
      fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
      const visual = await view.findByRole('textbox', { name: '可视化文章编辑器' });
      await waitFor(() =>
        expect(visual.getAttribute('data-easymde-preview-phase')).toBe('ready')
      );
      const blocks = visual.querySelectorAll('p');
      expect(blocks).toHaveLength(2);
      const tail = blocks[1];
      if (!(tail instanceof HTMLElement)) throw new Error('tail-block-missing');
      expect(tail.textContent).toBe('Tail');
      visual.focus();
      expect(document.activeElement).toBe(visual);
      // A real user selection inside the SECOND block, then the menu key.
      const tailText = tail.firstChild;
      if (!(tailText instanceof Text)) throw new Error('tail-text-missing');
      const range = document.createRange();
      range.setStart(tailText, 0);
      range.setEnd(tailText, tailText.data.length);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      const writesBefore = vi.mocked(
        props.editorClipboardPort?.write ?? (() => undefined)
      ).mock.calls.length;
      // The keyboard activation commits the menu in a React update, so the row
      // awaits that commit boundary explicitly (the pointer variants get it from
      // the preceding act) instead of racing findByRole's first poll.
      await act(async () => {
        fireEvent.keyDown(tail, { key: 'F10', shiftKey: true });
      });
      const menu = await within(document.body).findByRole('menu');
      expect(menu).toBeTruthy();
      // The captured demand is the Tail block: the keyboard activation keeps
      // the user's own selection, so the menu's Copy reproduces those bytes
      // and nothing from Lead.
      fireEvent.click(within(menu).getByRole('menuitem', { name: /^Copy$/ }));
      await waitFor(() =>
        expect(props.editorClipboardPort?.write).toHaveBeenCalledWith('Tail')
      );
      expect(props.submissionField.value).toBe(initial);
      expect(props.onFailure).not.toHaveBeenCalled();

      // A second gesture is cancelled by Escape: the menu goes away, its
      // witness is released, and the document and Clipboard stay untouched.
      const writesAfterCopy = vi.mocked(
        props.editorClipboardPort?.write ?? (() => undefined)
      ).mock.calls.length;
      // The block is re-queried from the LIVE surface: a preceding accepted
      // render may have replaced the paragraph node, and a stale detached node
      // cannot receive a keyboard activation at all.
      const liveTail = (): HTMLElement => {
        const node = visual.querySelectorAll('p')[1];
        if (!(node instanceof HTMLElement)) throw new Error('tail-block-gone');
        return node;
      };
      // The first gesture's Copy is a pure read, but the owner may still be
      // settling the selection it restored. Wait for the readiness the other
      // visual rows use before the second activation instead of racing it.
      await waitFor(() =>
        expect(visual.getAttribute('data-easymde-preview-phase')).toBe('ready')
      );
      expect(props.onFailure).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(visual);
      const restoredSelection = window.getSelection();
      expect(restoredSelection?.anchorNode?.isConnected).toBe(true);
      expect(liveTail().contains(restoredSelection?.anchorNode ?? null)).toBe(true);
      expect(restoredSelection?.toString()).toBe('Tail');
      await act(async () => {
        fireEvent.keyDown(liveTail(), { key: 'F10', shiftKey: true });
      });
      expect(props.onFailure).not.toHaveBeenCalled();
      const cancelled = await within(document.body).findByRole('menu');
      fireEvent.keyDown(cancelled, { key: 'Escape' });
      await waitFor(() =>
        expect(within(document.body).queryAllByRole('menu')).toHaveLength(0)
      );
      expect(
        vi.mocked(props.editorClipboardPort?.write ?? (() => undefined)).mock
          .calls.length
      ).toBe(writesAfterCopy);
      expect(writesAfterCopy).toBeGreaterThan(writesBefore);
      expect(props.onFailure).not.toHaveBeenCalled();
      expect(props.submissionField.value).toBe(initial);
    } finally {
      view.unmount();
    }
  });

  /**
   * The four table controls. Each one deletes one character from a delimiter
   * line, which the formal renderer reinterprets as a table while the
   * serialized source keeps its exact bytes. The pre-edit paragraph and the
   * post-edit table share the exact same source extent, so only the accepted
   * render can describe the table.
   */
  const tablePromotion = {
    equalEof: {
      // The named EOF counterexample: deleting the final byte of a lenient
      // delimiter promotes the paragraph into a valid table.
      after: 'a | b\n--- | ---',
      before: 'a | b\n--- | ---x',
      columns: 'equal' as const,
      scope: 'isolated' as const,
      deletion: { from: 15, to: 16 },
      region: 'eof' as const
    },
    equalInterior: {
      after: 'a | b\n--- | ---',
      before: 'a | b\n---x | ---',
      columns: 'equal' as const,
      scope: 'isolated' as const,
      deletion: { from: 9, to: 10 },
      region: 'interior' as const
    },
    unequalEof: {
      after: 'a | b\n--- | --- | ---',
      before: 'a | b\n--- | --- | ---x',
      columns: 'unequal' as const,
      scope: 'isolated' as const,
      deletion: { from: 21, to: 22 },
      region: 'eof' as const
    },
    unequalInterior: {
      after: 'a | b\n--- | --- | ---',
      before: 'a | b\n---x | --- | ---',
      columns: 'unequal' as const,
      scope: 'isolated' as const,
      deletion: { from: 9, to: 10 },
      region: 'interior' as const
    }
  };

  type PromotionCase = {
    before: string;
    after: string;
    columns: 'equal' | 'unequal';
    region: 'interior' | 'eof';
    scope: 'isolated' | 'held-neighbor';
    deletion: { from: number; to: number };
    neighbor?: string;
  };
  const neighborPromotions: PromotionCase[] = Object.values(tablePromotion).map((promotion) => ({
    ...promotion,
    scope: 'held-neighbor',
    before: `${promotion.before}\n\nTrailing native neighbor.`,
    after: `${promotion.after}\n\nTrailing native neighbor.`,
    neighbor: 'Trailing native neighbor.'
  }));

  /**
   * True when this fixture source's second line is a valid table delimiter row
   * with at least as many cells as the header row - the formal renderer's own
   * admission rule, which accepts a delimiter wider than the header and pads
   * the missing header cells.
   */
  function promotionTableShape(markdown: string): boolean {
    const lines = markdown.split('\n');
    const header = lines[0] ?? '';
    const delimiter = lines[1] ?? '';
    if ('' === header.trim() || '' === delimiter.trim()) return false;
    const delimiterCells = delimiter.split('|');
    if (delimiterCells.length < header.split('|').length) return false;
    return delimiterCells.every((cell) => /^\s*:?-+:?\s*$/u.test(cell));
  }

  /**
   * A truthful accepted response for ANY source these promotion fixtures can
   * produce, including the sources a continued native edit creates. Blank
   * separator lines are not blocks, and the table shape follows the renderer's
   * own admission rule rather than a label.
   */
  function promotionSourceResponse(
    markdown: string,
    request: PreviewRequest
  ): PreviewResponse {
    if ('' === markdown) {
      return {
        editMap: {
          blocks: [],
          coordinate: 'line' as const,
          signature: request.signature,
          version: 1 as const
        },
        features: {},
        html: '' as SafePreviewHtml
      };
    }
    const lines = markdown.split('\n');
    if (promotionTableShape(markdown)) {
      const headerCells = (lines[0] ?? '').split('|');
      const delimiterCells = (lines[1] ?? '').split('|');
      const cells = delimiterCells
        .map((_cell, index) => `<th>${(headerCells[index] ?? '').trim()}</th>`)
        .join('');
      // The table owns the first two lines; any further non-blank line is its
      // own ordinary paragraph, exactly like every other block in these
      // fixtures - a trailing paragraph is not swallowed into the table.
      const blocks: Array<{
        editable: true;
        endLine: number;
        id: string;
        startLine: number;
      }> = [{ editable: true, endLine: 2, id: 'b0', startLine: 0 }];
      let html =
        '<section class="table-container easymde-table-container" data-easymde-visual-block-id="b0">'
        + `<table><thead><tr>${cells}</tr></thead></table></section>`;
      for (let index = 2; index < lines.length; index += 1) {
        const line = lines[index] ?? '';
        if ('' === line) continue;
        const id = `b${blocks.length}`;
        blocks.push({ editable: true, endLine: index + 1, id, startLine: index });
        html += `<p data-easymde-visual-block-id="${id}">${line}</p>`;
      }
      return {
        editMap: {
          blocks,
          coordinate: 'line' as const,
          signature: request.signature,
          version: 1 as const
        },
        features: {},
        html: html as SafePreviewHtml
      };
    }
    const blocks: Array<{
      editable: true;
      endLine: number;
      id: string;
      startLine: number;
    }> = [];
    const html: string[] = [];
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? '';
      if ('' === line) continue;
      const id = `b${blocks.length}`;
      blocks.push({ editable: true, endLine: index + 1, id, startLine: index });
      html.push(`<p data-easymde-visual-block-id="${id}">${line}</p>`);
    }
    return {
      editMap: {
        blocks,
        coordinate: 'line' as const,
        signature: request.signature,
        version: 1 as const
      },
      features: {},
      html: html.join('') as SafePreviewHtml
    };
  }

  /**
   * The two exact response shapes. No renderer is approximated here: the
   * pre-deletion source is the paragraph the formal renderer produces, and the
   * post-deletion source is the table it produces. Anything else is a fixture
   * bug, so an unexpected source throws.
   */
  function tablePromotionResponse(
    promotion: PromotionCase,
    request: PreviewRequest
  ): PreviewResponse {
    const beforeBlock = promotion.before.split('\n\n')[0] ?? '';
    const editMap = {
      blocks: [
        { editable: true as const, endLine: 2, id: 'b0', startLine: 0 },
        ...(promotion.neighbor ? [{ editable: true as const, endLine: 4, id: 'b1', startLine: 3 }] : [])
      ],
      coordinate: 'line' as const,
      signature: request.signature,
      version: 1 as const
    };
    if (request.markdown === promotion.before) {
      return {
        editMap,
        features: {},
        html: (
          `<p data-easymde-visual-block-id="b0">${beforeBlock}</p>`
          + (promotion.neighbor ? `<p data-easymde-visual-block-id="b1">${promotion.neighbor}</p>` : '')
        ) as SafePreviewHtml
      };
    }
    if ('' === request.markdown) {
      // Deleting the table empties the document; the shared builder returns the
      // zero-block empty paper the owner presents for that map.
      return promotionSourceResponse('', request);
    }
    if (request.markdown !== promotion.after) {
      throw new Error('table-promotion-unexpected-source');
    }
    // The promoted source is delivered by the shared truthful builder, so the
    // equal and unequal shapes follow the same formal admission rule as any
    // source a continued native edit produces.
    return promotionSourceResponse(promotion.after, request);
  }

  /**
   * Drive the real native deletion the browser performs: prevent-default
   * aware, mutating the DOM only when the owner did not consume the event,
   * then publishing the matching input event. The owner - not the test -
   * commits the canonical source from its own serialization.
   */
  function nativeDelete(
    visual: HTMLElement,
    text: Text,
    from: number,
    to: number
  ): void {
    const range = document.createRange();
    range.setStart(text, from);
    range.setEnd(text, to);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    const before = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'deleteContentBackward'
    });
    visual.dispatchEvent(before);
    if (!before.defaultPrevented) {
      text.deleteData(from, to - from);
      const caret = document.createRange();
      caret.setStart(text, from);
      caret.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(caret);
    }
    visual.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        inputType: 'deleteContentBackward'
      })
    );
  }

  function tablePromotionFixture(
    promotion: PromotionCase
  ) {
    const props = fixture();
    props.submissionField.value = promotion.before;
    props.submissionField.defaultValue = promotion.before;
    props.submissionField.setSelectionRange(0, 0);
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      Promise.resolve(tablePromotionResponse(promotion, request))
    );
    // Capture the REAL factory and install one spy for THIS run only. The caller
    // restores it in its own `finally`, so a later fresh run starts from the
    // real factory instead of wrapping an earlier spy (which would layer the
    // mocks and make the observed owner ambiguous).
    const realCreateDocumentSession =
      observedSourceAdapter.createCodeMirrorDocumentSession;
    const ownerRef: {
      current: CodeMirrorDocumentSession | null;
    } = { current: null };
    const receiptResults: boolean[] = [];
    const receiptReplayResults: boolean[] = [];
    const receiptPublications: Array<{
      value: string | undefined;
      revision: number | undefined;
      history: { undoDepth: number; redoDepth: number } | undefined;
      before: EditorContextMenuSurfaceSnapshot;
      after: EditorContextMenuSurfaceSnapshot;
      selection: DocumentSelection | undefined;
      nativeAnchor: Node | null | undefined;
      nativeFocus: Node | null | undefined;
      nativeAnchorOffset: number | undefined;
      nativeFocusOffset: number | undefined;
      nativeCollapsed: boolean | undefined;
      activeElement: Element | null;
    }> = [];
    const realVisualOwner = observedVisualOwner.ImmersiveVisualEditor;
    const visualSpy = vi.spyOn(observedVisualOwner, 'ImmersiveVisualEditor').mockImplementation((componentProps) => {
      const onReady = observedCallback((runtime: ImmersiveVisualEditorRuntime) => {
        const capture = runtime.captureContextMenuTarget;
        const captureContextMenuTarget: ImmersiveVisualEditorRuntime['captureContextMenuTarget'] = (target) => {
          // Observe only the owner's definition during this synchronous capture.
          // The real lease, receiver, arguments, result and immutable descriptor
          // flags survive unchanged; no published member is replaced or proxied.
          const defineProperty = Object.defineProperty;
          const definitions: unknown[] = [];
          const definitionSpy = vi.spyOn(Object, 'defineProperty').mockImplementation((object, key, descriptor) => {
            if ('consumeAcceptedSelectionTransition' !== key || 'function' !== typeof descriptor.value) {
              return defineProperty(object, key, descriptor);
            }
            definitions.push(object);
            const consume = descriptor.value as NonNullable<EditorContextMenuTargetLease['consumeAcceptedSelectionTransition']>;
            const observedConsume: typeof consume = function (this: unknown, ...args: Parameters<typeof consume>) {
              const consumed = Reflect.apply(consume, this, args) as boolean;
              receiptResults.push(consumed);
              if (consumed) {
                const native = window.getSelection();
                receiptPublications.push({
                  value: ownerRef.current?.getValue(),
                  revision: ownerRef.current?.getRevision?.(),
                  history: ownerRef.current?.getHistoryState(),
                  before: {
                    ...args[0],
                    selection: { ...args[0].selection }
                  },
                  after: {
                    ...args[1],
                    selection: { ...args[1].selection }
                  },
                  selection: ownerRef.current?.getSelection(),
                  nativeAnchor: native?.anchorNode,
                  nativeFocus: native?.focusNode,
                  nativeAnchorOffset: native?.anchorOffset,
                  nativeFocusOffset: native?.focusOffset,
                  nativeCollapsed: native?.isCollapsed,
                  activeElement: document.activeElement
                });
                // Separate probe, not a second Feature invocation: even while
                // publication is still synchronous/live, consumed is one-shot.
                receiptReplayResults.push(Reflect.apply(consume, this, args) as boolean);
              }
              return consumed;
            };
            return defineProperty(object, key, { ...descriptor, value: observedConsume });
          });
          let lease: EditorContextMenuTargetLease | null;
          try {
            lease = capture(target);
          } finally {
            definitionSpy.mockRestore();
          }
          expect(definitions).toHaveLength(lease?.consumeAcceptedSelectionTransition ? 1 : 0);
          if (lease?.consumeAcceptedSelectionTransition) expect(definitions[0]).toBe(lease);
          return lease;
        };
        componentProps.onReady({ ...runtime, captureContextMenuTarget });
      }, [componentProps.onReady]);
      return realVisualOwner({ ...componentProps, onReady });
    });
    const sessionSpy = vi
      .spyOn(observedSourceAdapter, 'createCodeMirrorDocumentSession')
      .mockImplementation((session) => {
        const owner = realCreateDocumentSession(session);
        ownerRef.current = owner;
        return owner;
      });
    return {
      owner: () => ownerRef.current,
      promotion,
      receiptResults,
      receiptReplayResults,
      receiptPublications,
      props,
      restore: () => { sessionSpy.mockRestore(); visualSpy.mockRestore(); }
    };
  }
  async function roundTripPromotionCopy(
    owner: CodeMirrorDocumentSession,
    visual: HTMLElement,
    promotion: PromotionCase,
    historyBefore: DocumentHistoryState
  ): Promise<void> {
    const copiedRevision = owner.getRevision?.();
    if (undefined === copiedRevision) throw new Error('promotion-copy-revision-missing');
    expect(owner.getHistoryState()).toEqual({ undoDepth: historyBefore.undoDepth + 1, redoDepth: 0 });
    fireEvent.keyDown(visual, { cancelable: true, ctrlKey: true, key: 'z' });
    await waitFor(() => expect(owner.getValue()).toBe(promotion.before));
    await waitFor(() => expect(visual.querySelector('table')).toBeNull());
    await waitFor(() => expect(visual.getAttribute('data-easymde-preview-phase')).toBe('ready'));
    expect(visual.getAttribute('contenteditable')).toBe('true');
    expect(visual.querySelector('table')).toBeNull();
    expect(owner.getHistoryState()).toEqual({ undoDepth: historyBefore.undoDepth, redoDepth: 1 });
    expect(owner.getRevision?.()).toBe(copiedRevision + 1);
    fireEvent.keyDown(visual, { cancelable: true, ctrlKey: true, key: 'z', shiftKey: true });
    await waitFor(() => expect(owner.getValue()).toBe(promotion.after));
    await waitFor(() => expect(visual.querySelector('table')).not.toBeNull());
    await waitFor(() => expect(visual.getAttribute('data-easymde-preview-phase')).toBe('ready'));
    expect(visual.getAttribute('contenteditable')).toBe('true');
    expect(visual.querySelector('table')).not.toBeNull();
    expect(owner.getHistoryState()).toEqual({ undoDepth: historyBefore.undoDepth + 1, redoDepth: 0 });
    expect(owner.getRevision?.()).toBe(copiedRevision + 2);
  }


  it.each([
    tablePromotion.equalInterior,
    tablePromotion.equalEof,
    ...neighborPromotions.filter(({ columns }) => 'equal' === columns)
  ].flatMap((promotion) => (['copy', 'cut', 'delete-table'] as const).map((operation) => ({ ...promotion, operation }))))(
    'completes the $columns $region $scope table promotion with real $operation and native history',
    async (promotion: PromotionCase & { operation: 'copy' | 'cut' | 'delete-table' }) => {
      // Each operation owns a fresh document, gesture and independently held
      // formal Preview and genuine producer result; no row rescues another.
      const operation = promotion.operation;
        const tableBytes = promotion.after.split('\n\n')[0] ?? '';
        const remainder = promotion.neighbor ? `\n\n${promotion.neighbor}` : '';
        const parts = tablePromotionFixture(promotion);
        const { props } = parts;
        // The worker barrier holds the REAL producer's own result for C, not a
        // synthesised one-paragraph-per-line shape.
        const demandedIndex = observedBlockIndex(promotion.after);
        const heldPreview = deferred<PreviewResponse>();
        const heldIndex = deferred<EditorMarkdownBlockIndexData>();
        let holdDemandPreview = false;
        let holdDemandIndex = false;
        const indexPort: EditorMarkdownBlockIndexPort = {
          build: vi.fn(async ({ source }) => {
            if (holdDemandIndex && promotion.after === source) {
              return heldIndex.promise;
            }
            return observedBlockIndex(source);
          }),
          dispose: vi.fn()
        };
        // The two promotion shapes - the ORIGINAL pre-promotion source, the
        // promoted source, and the emptied document - come from the explicit
        // `tablePromotionResponse` fixture, exactly as the cancellation row does.
        // Only a source this fixture cannot name (a typed or history-restored
        // source) uses the source-specific builder.
        vi.mocked(props.previewPort.render).mockImplementation((request) =>
          holdDemandPreview && promotion.after === request.markdown
            ? heldPreview.promise
            : Promise.resolve(
                request.markdown === promotion.before
                || request.markdown === promotion.after
                || '' === request.markdown
                  ? tablePromotionResponse(promotion, request)
                  : promotionSourceResponse(request.markdown, request)
              )
        );
        const view = render(
          <EditorRoot {...props} editorBlockIndexPort={indexPort} />
        );
        try {
          fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
          fireEvent.click(view.getByRole('button', { name: '预览' }));
          await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
          layoutPreviewSurface(view.container);
          fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
          const visual = await view.findByRole('textbox', {
            name: '可视化文章编辑器'
          });
          await waitFor(() =>
            expect(visual.getAttribute('data-easymde-preview-phase')).toBe('ready')
          );
          const owner = parts.owner();
          if (!owner) throw new Error('table-promotion-owner-missing');
          const historyBefore = owner.getHistoryState();
          const revisionBefore = owner.getRevision?.();
          if (undefined === revisionBefore) throw new Error('promotion-revision-missing');
          expect(historyBefore).toEqual({ undoDepth: 0, redoDepth: 0 });

          expect(promotion.deletion.to === promotion.before.split('\n\n')[0]?.length).toBe(
            'eof' === promotion.region
          );
          const paragraph = visual.querySelector('p')?.firstChild;
          if (!(paragraph instanceof Text)) {
            throw new Error('table-promotion-paragraph-missing');
          }
          // Arm both prerequisites BEFORE the deletion: the deletion's own
          // re-authentication is the single request this row holds, and the
          // gesture then joins that pending transfer instead of issuing another.
          const requestsBefore = vi.mocked(props.previewPort.render).mock.calls.length;
          holdDemandPreview = true;
          holdDemandIndex = true;
          nativeDelete(
            visual,
            paragraph,
            promotion.deletion.from,
            promotion.deletion.to
          );
          await waitFor(() => expect(owner.getValue()).toBe(promotion.after));
          // The deletion caret is retained exactly.
          expect(owner.getSelection()).toEqual({
            direction: 'none',
            end: promotion.deletion.from,
            start: promotion.deletion.from
          });
          expect(owner.getSelection().start === tableBytes.length).toBe(
            'eof' === promotion.region
          );
          expect(owner.getHistoryState().undoDepth).toBe(historyBefore.undoDepth + 1);
          expect(owner.getRevision?.()).toBe(revisionBefore + 1);
          const revisionAfterDeletion = owner.getRevision?.();

          const oldParagraph = visual.querySelector('p');
          if (!(oldParagraph instanceof HTMLElement)) {
            throw new Error('table-promotion-pointed-paragraph-missing');
          }
          layoutContextMenuSurface(oldParagraph);
          fireEvent.pointerDown(oldParagraph, {
            button: 2,
            clientX: 20,
            clientY: 20
          });
          fireEvent.contextMenu(oldParagraph, { clientX: 20, clientY: 20 });

          // Exactly ONE request belongs to this promotion: the deletion's own
          // re-authentication, which the gesture joined while it was held.
          await waitFor(() =>
            expect(vi.mocked(props.previewPort.render).mock.calls.length).toBe(
              requestsBefore + 1
            )
          );
          expect(
            vi.mocked(props.previewPort.render).mock.calls.at(-1)?.[0].markdown
          ).toBe(promotion.after);
          const demandRequest = vi.mocked(props.previewPort.render).mock
            .calls.at(-1)?.[0];
          if (!demandRequest) throw new Error('table-promotion-demand-missing');
          await waitFor(() =>
            expect(
              vi.mocked(indexPort.build).mock.calls.some(
                ([request]) => request.source === promotion.after
              )
            ).toBe(true)
          );
          await act(async () => {
            await Promise.resolve();
          });
          // No menu, no table submenu, and no document/history/Clipboard write
          // while either prerequisite is outstanding.
          expect(within(document.body).queryAllByRole('menu')).toHaveLength(0);
          expect(within(document.body).queryByRole('menuitem', {
            name: 'Table'
          })).toBeNull();
          expect(owner.getValue()).toBe(promotion.after);
          expect(owner.getHistoryState().undoDepth).toBe(
            historyBefore.undoDepth + 1
          );
          expect(props.onFailure).not.toHaveBeenCalled();
          expect(parts.receiptResults).toEqual([]);
          expect(props.editorClipboardPort.write).not.toHaveBeenCalled();
          expect(owner.getRevision?.()).toBe(revisionBefore + 1);
          expect(owner.getHistoryState()).toEqual({ undoDepth: 1, redoDepth: 0 });

          // Deliver the FORMAL Preview response first: the genuine worker result
          // is still held, so a demand that opened on the render alone would be
          // observable here.
          heldPreview.resolve(tablePromotionResponse(promotion, demandRequest));
          await waitFor(() =>
            expect(visual.getAttribute('data-easymde-preview-phase')).toBe('ready')
          );
          await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
          });
          expect(within(document.body).queryAllByRole('menu')).toHaveLength(0);
          expect(within(document.body).queryByRole('menuitem', {
            name: 'Table'
          })).toBeNull();
          // The accepted render really installed the table while the menu stays
          // closed, so the remaining barrier is the inventory, not the render.
          expect(visual.querySelector('table')).not.toBeNull();
          expect(owner.getValue()).toBe(promotion.after);

          // Now deliver the producer's own result for exactly this source.
          expect(demandedIndex.source).toBe(promotion.after);
          expect(demandedIndex.length).toBe(promotion.after.length);
          heldIndex.resolve(demandedIndex);
          await waitFor(
            () =>
              expect(within(document.body).queryAllByRole('menu')).toHaveLength(1),
            { timeout: 5000 }
          );
          expect(vi.mocked(props.previewPort.render).mock.calls.length).toBe(
            requestsBefore + 1
          );
          // Disarm the held mocks: every later legitimate request (the emptied
          // source, and each Undo/Redo refresh) must get a FRESH response for
          // its own request, never this obsolete held one.
          holdDemandPreview = false;
          holdDemandIndex = false;
          // The accepted render installed the formal table root and the old
          // paragraph is really gone.
          expect(visual.querySelector('p')?.textContent ?? '').toBe(promotion.neighbor ?? '');
          const acceptedTable = visual.querySelector('table');
          if (!(acceptedTable instanceof HTMLTableElement)) {
            throw new Error('table-promotion-table-missing');
          }
          expect(
            acceptedTable.querySelectorAll('thead > tr > th')
          ).toHaveLength(2);
          expect(owner.getValue()).toBe(promotion.after);
          expect(props.onFailure).not.toHaveBeenCalled();

          const menu = within(document.body).getByRole('menu');
          // Both the interior and delimiter-end caret are inside the exact
          // changed-kind extent (the end is inclusive). The accepted owner
          // therefore publishes its mapped first-header caret, not an EOF
          // exception: one selection-only transition from deletion.from to 0.
          const firstHeaderText = acceptedTable.querySelector('thead th')?.firstChild;
          expect(firstHeaderText).toBeInstanceOf(Text);
          expect(firstHeaderText?.isConnected).toBe(true);
          expect(parts.receiptResults.filter(Boolean)).toHaveLength(1);
          expect(parts.receiptReplayResults).toEqual([false]);
          expect(parts.receiptPublications).toEqual([{
            value: promotion.after,
            revision: revisionBefore + 1,
            history: { undoDepth: 1, redoDepth: 0 },
            before: {
              value: promotion.after,
              revision: revisionBefore + 1,
              selection: { direction: 'none', start: promotion.deletion.from, end: promotion.deletion.from }
            },
            after: {
              value: promotion.after,
              revision: revisionBefore + 1,
              selection: { direction: 'none', start: 0, end: 0 }
            },
            selection: { direction: 'none', start: 0, end: 0 },
            nativeAnchor: firstHeaderText,
            nativeFocus: firstHeaderText,
            nativeAnchorOffset: 0,
            nativeFocusOffset: 0,
            nativeCollapsed: true,
            activeElement: visual
          }]);
          expect(oldParagraph.isConnected).toBe(false);
          expect(owner.getRevision?.()).toBe(revisionBefore + 1);
          expect(owner.getHistoryState()).toEqual({ undoDepth: 1, redoDepth: 0 });
          if ('copy' === operation) {
            fireEvent.click(
              within(menu).getByRole('menuitem', { name: 'Copy / Paste as' })
            );
            fireEvent.click(
              await within(document.body).findByRole('menuitem', {
                name: 'Copy as Markdown'
              })
            );
            // The clipboard receives the exact promoted bytes.
            await waitFor(() =>
              expect(props.editorClipboardPort.write).toHaveBeenCalledWith(
                tableBytes
              )
            );
            // Copy writes nothing at all.
            expect(owner.getValue()).toBe(promotion.after);
            expect(owner.getRevision?.()).toBe(revisionAfterDeletion);
            expect(owner.getHistoryState().undoDepth).toBe(
              historyBefore.undoDepth + 1
            );
            await roundTripPromotionCopy(owner, visual, promotion, historyBefore);
            return;
          }

          if ('cut' === operation) {
            fireEvent.click(within(menu).getByRole('menuitem', { name: /^Cut$/ }));
            await waitFor(() =>
              expect(props.editorClipboardPort.write).toHaveBeenCalledWith(
                tableBytes,
                expect.objectContaining({ signal: expect.any(AbortSignal) })
              )
            );
          } else {
            const tableEntry = within(menu).getByRole('menuitem', { name: 'Table' });
            expect(tableEntry.getAttribute('aria-disabled')).toBe('false');
            fireEvent.mouseEnter(tableEntry);
            const deleteTable = await within(document.body).findByRole('menuitem', {
              name: 'Delete table'
            });
            expect(deleteTable.getAttribute('aria-disabled')).toBe('false');
            fireEvent.click(deleteTable);
          }
          await waitFor(() => expect(owner.getValue()).toBe(remainder));
          // The accepted DOM barrier for the emptied document: the table is
          // really gone before native history is exercised.
          await waitFor(() => expect(visual.querySelector('table')).toBeNull());
          await waitFor(() =>
            expect(visual.getAttribute('data-easymde-preview-phase')).toBe('ready')
          );
          expect(owner.getHistoryState().undoDepth).toBe(
            historyBefore.undoDepth + 2
          );
          expect(owner.getHistoryState().redoDepth).toBe(0);
          expect(owner.getRevision?.()).toBe(revisionBefore + 2);
          expect(visual.querySelector('p')?.textContent ?? '').toBe(promotion.neighbor ?? '');

          // Native history: Undo restores the exact promoted source AND the
          // actual table DOM; Redo completes the empty document again, with the
          // accepted readiness/editability barrier after each transition.
          fireEvent.keyDown(visual, { cancelable: true, ctrlKey: true, key: 'z' });
          await waitFor(() => expect(owner.getValue()).toBe(promotion.after));
          await waitFor(() =>
            expect(visual.querySelector('table')).not.toBeNull()
          );
          await waitFor(() =>
            expect(visual.getAttribute('data-easymde-preview-phase')).toBe('ready')
          );
          expect(visual.getAttribute('contenteditable')).toBe('true');
          expect(owner.getHistoryState().undoDepth).toBe(
            historyBefore.undoDepth + 1
          );
          expect(owner.getHistoryState().redoDepth).toBe(1);
          expect(owner.getRevision?.()).toBe(revisionBefore + 3);
          expect(visual.querySelector('p')?.textContent ?? '').toBe(promotion.neighbor ?? '');
          fireEvent.keyDown(visual, {
            cancelable: true,
            ctrlKey: true,
            key: 'z',
            shiftKey: true
          });
          await waitFor(() => expect(owner.getValue()).toBe(remainder));
          await waitFor(() => expect(visual.querySelector('table')).toBeNull());
          await waitFor(() =>
            expect(visual.getAttribute('data-easymde-preview-phase')).toBe('ready')
          );
          expect(visual.getAttribute('contenteditable')).toBe('true');
          expect(owner.getHistoryState()).toEqual({
            undoDepth: historyBefore.undoDepth + 2,
            redoDepth: 0
          });
          expect(owner.getRevision?.()).toBe(revisionBefore + 4);
          expect(visual.querySelector('p')?.textContent ?? '').toBe(promotion.neighbor ?? '');
          expect(props.onFailure).not.toHaveBeenCalled();
        } finally {
          view.unmount();
          // Restore the real factory before the next fresh run installs its own
          // spy, so no spy survives its run.
          parts.restore();
        }
    }
  );

  it.each([
    tablePromotion.unequalInterior,
    tablePromotion.unequalEof,
    ...neighborPromotions.filter(({ columns }) => 'unequal' === columns)
  ].flatMap((promotion) => (['copy', 'cut'] as const).map((operation) => ({ ...promotion, operation }))))(
    'keeps the deletion caret through the $columns $region $scope promotion for real $operation and refuses only the table submenu',
    async (promotion: PromotionCase & { operation: 'copy' | 'cut' }) => {
      // The formal renderer accepts this shape as a table even though its
      // three-cell delimiter faces a two-cell header (third header cell empty),
      // and the accepted render installs that table. The context menu's own
      // table rules refuse the mismatch, so the ONLY thing that goes missing is
      // the `Table` submenu - not the promotion, not the one gesture, and not
      // the accepted DOM. The caret stays exactly where the deletion left it.
      // Both generic outcomes run in their own fresh run from their own first
      // menu, each holding the Preview response AND the genuine worker result.
      const operation = promotion.operation;
        const parts = tablePromotionFixture(promotion);
        const tableBytes = promotion.after.split('\n\n')[0] ?? '';
        const remainder = promotion.neighbor ? `\n\n${promotion.neighbor}` : '';
        const { props } = parts;
        const demandedIndex = observedBlockIndex(promotion.after);
        const heldPreview = deferred<PreviewResponse>();
        const heldIndex = deferred<EditorMarkdownBlockIndexData>();
        let holdDemandPreview = false;
        let holdDemandIndex = false;
        const indexPort: EditorMarkdownBlockIndexPort = {
          build: vi.fn(async ({ source }) => {
            if (holdDemandIndex && promotion.after === source) {
              return heldIndex.promise;
            }
            return observedBlockIndex(source);
          }),
          dispose: vi.fn()
        };
        // As in the equal-column group: the named promotion shapes use the
        // explicit fixture, and only typed/history-restored sources fall back to
        // the source-specific builder.
        vi.mocked(props.previewPort.render).mockImplementation((request) =>
          holdDemandPreview && promotion.after === request.markdown
            ? heldPreview.promise
            : Promise.resolve(
                request.markdown === promotion.before
                || request.markdown === promotion.after
                || '' === request.markdown
                  ? tablePromotionResponse(promotion, request)
                  : promotionSourceResponse(request.markdown, request)
              )
        );
        const view = render(
          <EditorRoot {...props} editorBlockIndexPort={indexPort} />
        );
        try {
          fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
          fireEvent.click(view.getByRole('button', { name: '预览' }));
          await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
          layoutPreviewSurface(view.container);
          fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
          const visual = await view.findByRole('textbox', {
            name: '可视化文章编辑器'
          });
          await waitFor(() =>
            expect(visual.getAttribute('data-easymde-preview-phase')).toBe('ready')
          );
          const owner = parts.owner();
          if (!owner) throw new Error('unequal-promotion-owner-missing');
          const requestsBefore = vi.mocked(props.previewPort.render).mock.calls.length;
          const historyBefore = owner.getHistoryState();
          const revisionBefore = owner.getRevision?.();
          if (undefined === revisionBefore) throw new Error('promotion-revision-missing');
          expect(historyBefore).toEqual({ undoDepth: 0, redoDepth: 0 });

          expect(promotion.deletion.to === promotion.before.split('\n\n')[0]?.length).toBe(
            'eof' === promotion.region
          );
          const paragraph = visual.querySelector('p')?.firstChild;
          if (!(paragraph instanceof Text)) {
            throw new Error('unequal-promotion-paragraph-missing');
          }
          nativeDelete(
            visual,
            paragraph,
            promotion.deletion.from,
            promotion.deletion.to
          );
          await waitFor(() => expect(owner.getValue()).toBe(promotion.after));
          // The OWNER committed one history entry and moved no caret: the
          // deletion offset is still the canonical selection.
          expect(owner.getSelection()).toEqual({
            direction: 'none',
            end: promotion.deletion.from,
            start: promotion.deletion.from
          });
          expect(owner.getHistoryState().undoDepth).toBe(
            historyBefore.undoDepth + 1
          );
          expect(owner.getRevision?.()).toBe(revisionBefore + 1);
          const revisionAfterDeletion = owner.getRevision?.();

          // The ONE gesture, on the still-mounted pre-promotion paragraph, with
          // both prerequisites held.
          holdDemandPreview = true;
          holdDemandIndex = true;
          const oldParagraph = visual.querySelector('p');
          if (!(oldParagraph instanceof HTMLElement)) {
            throw new Error('unequal-promotion-paragraph-element-missing');
          }
          layoutContextMenuSurface(oldParagraph);
          fireEvent.pointerDown(oldParagraph, {
            button: 2,
            clientX: 20,
            clientY: 20
          });
          fireEvent.contextMenu(oldParagraph, { clientX: 20, clientY: 20 });

          // Exactly one formal request, for the post-deletion source, plus a
          // genuine worker build for that same source.
          await waitFor(() =>
            expect(vi.mocked(props.previewPort.render).mock.calls.length).toBe(
              requestsBefore + 1
            )
          );
          expect(
            vi.mocked(props.previewPort.render).mock.calls.at(-1)?.[0].markdown
          ).toBe(promotion.after);
          const demandRequest = vi.mocked(props.previewPort.render).mock
            .calls.at(-1)?.[0];
          if (!demandRequest) throw new Error('unequal-promotion-demand-missing');
          await waitFor(() =>
            expect(
              vi.mocked(indexPort.build).mock.calls.some(
                ([request]) => request.source === promotion.after
              )
            ).toBe(true)
          );
          await act(async () => {
            await Promise.resolve();
          });
          expect(within(document.body).queryAllByRole('menu')).toHaveLength(0);
          expect(parts.receiptResults).toEqual([]);
          expect(props.editorClipboardPort.write).not.toHaveBeenCalled();
          expect(owner.getRevision?.()).toBe(revisionBefore + 1);
          expect(owner.getHistoryState()).toEqual({ undoDepth: 1, redoDepth: 0 });
          expect(within(document.body).queryByRole('menuitem', {
            name: 'Table'
          })).toBeNull();
          expect(owner.getValue()).toBe(promotion.after);
          expect(owner.getHistoryState().undoDepth).toBe(
            historyBefore.undoDepth + 1
          );

          // Preview first: the worker result is still held.
          heldPreview.resolve(tablePromotionResponse(promotion, demandRequest));
          await waitFor(() =>
            expect(visual.getAttribute('data-easymde-preview-phase')).toBe('ready')
          );
          await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
          });
          expect(within(document.body).queryAllByRole('menu')).toHaveLength(0);
          expect(within(document.body).queryByRole('menuitem', {
            name: 'Table'
          })).toBeNull();
          expect(visual.querySelector('table')).not.toBeNull();

          // Then the producer's own result for exactly this source.
          heldIndex.resolve(demandedIndex);
          await waitFor(
            () =>
              expect(within(document.body).queryAllByRole('menu')).toHaveLength(1),
            { timeout: 5000 }
          );
          holdDemandPreview = false;
          holdDemandIndex = false;
          expect(vi.mocked(props.previewPort.render).mock.calls.length).toBe(
            requestsBefore + 1
          );
          // A genuinely NEW accepted DOM: the paragraph is gone and the formal
          // table, with its three delimiter columns and empty third header cell,
          // is what the accepted render installed.
          expect(visual.querySelector('p')?.textContent ?? '').toBe(promotion.neighbor ?? '');
          const acceptedTable = visual.querySelector('table');
          if (!(acceptedTable instanceof HTMLTableElement)) {
            throw new Error('unequal-promotion-table-missing');
          }
          const headerCells = acceptedTable.querySelectorAll('thead > tr > th');
          expect(headerCells).toHaveLength(3);
          expect(headerCells[2]?.textContent).toBe('');
          expect(owner.getValue()).toBe(promotion.after);
          expect(props.onFailure).not.toHaveBeenCalled();

          const menu = within(document.body).getByRole('menu');
          // Delimiter-end is eligible for the same exact changed-kind
          // normalization as interior; it is not a zero-receipt special case.
          const firstHeaderText = acceptedTable.querySelector('thead th')?.firstChild;
          expect(firstHeaderText).toBeInstanceOf(Text);
          expect(firstHeaderText?.isConnected).toBe(true);
          expect(parts.receiptResults.filter(Boolean)).toHaveLength(1);
          expect(parts.receiptReplayResults).toEqual([false]);
          expect(parts.receiptPublications).toEqual([{
            value: promotion.after,
            revision: revisionBefore + 1,
            history: { undoDepth: 1, redoDepth: 0 },
            before: {
              value: promotion.after,
              revision: revisionBefore + 1,
              selection: { direction: 'none', start: promotion.deletion.from, end: promotion.deletion.from }
            },
            after: {
              value: promotion.after,
              revision: revisionBefore + 1,
              selection: { direction: 'none', start: 0, end: 0 }
            },
            selection: { direction: 'none', start: 0, end: 0 },
            nativeAnchor: firstHeaderText,
            nativeFocus: firstHeaderText,
            nativeAnchorOffset: 0,
            nativeFocusOffset: 0,
            nativeCollapsed: true,
            activeElement: visual
          }]);
          expect(oldParagraph.isConnected).toBe(false);
          expect(owner.getRevision?.()).toBe(revisionBefore + 1);
          expect(owner.getHistoryState()).toEqual({ undoDepth: 1, redoDepth: 0 });
          // The table grammar refuses the mismatch, so only the submenu is
          // absent; every generic text command stays available.
          expect(
            within(menu).queryByRole('menuitem', { name: 'Table' })
          ).toBeNull();

          if ('copy' === operation) {
            fireEvent.click(
              within(menu).getByRole('menuitem', { name: 'Copy / Paste as' })
            );
            fireEvent.click(
              await within(document.body).findByRole('menuitem', {
                name: 'Copy as Markdown'
              })
            );
            await waitFor(() =>
              expect(props.editorClipboardPort.write).toHaveBeenCalledWith(
                tableBytes
              )
            );
            // A Copy writes nothing: no source, revision, or history change.
            expect(owner.getValue()).toBe(promotion.after);
            expect(owner.getRevision?.()).toBe(revisionAfterDeletion);
            expect(owner.getHistoryState().undoDepth).toBe(
              historyBefore.undoDepth + 1
            );
            expect(owner.getHistoryState().redoDepth).toBe(0);
            await roundTripPromotionCopy(owner, visual, promotion, historyBefore);
            return;
          }

          // Actual generic Cut of that same accepted extent.
          fireEvent.click(within(menu).getByRole('menuitem', { name: /^Cut$/ }));
          await waitFor(() =>
            expect(props.editorClipboardPort.write).toHaveBeenCalledWith(
              tableBytes,
              expect.objectContaining({ signal: expect.any(AbortSignal) })
            )
          );
          await waitFor(() => expect(owner.getValue()).toBe(remainder));
          await waitFor(() =>
            expect(visual.getAttribute('data-easymde-preview-phase')).toBe('ready')
          );
          expect(owner.getHistoryState().undoDepth).toBe(
            historyBefore.undoDepth + 2
          );
          expect(owner.getHistoryState().redoDepth).toBe(0);
          expect(owner.getRevision?.()).toBe(revisionBefore + 2);
          expect(visual.querySelector('p')?.textContent ?? '').toBe(promotion.neighbor ?? '');

          // Native history over the real document: Undo restores the promoted
          // table and its exact bytes, Redo completes the cut again - each with
          // its own accepted readiness/editability barrier.
          fireEvent.keyDown(visual, { cancelable: true, ctrlKey: true, key: 'z' });
          await waitFor(() => expect(owner.getValue()).toBe(promotion.after));
          await waitFor(() =>
            expect(visual.querySelector('table')).not.toBeNull()
          );
          await waitFor(() =>
            expect(visual.getAttribute('data-easymde-preview-phase')).toBe('ready')
          );
          expect(visual.getAttribute('contenteditable')).toBe('true');
          expect(owner.getHistoryState()).toEqual({
            undoDepth: historyBefore.undoDepth + 1,
            redoDepth: 1
          });
          expect(owner.getRevision?.()).toBe(revisionBefore + 3);
          expect(visual.querySelector('p')?.textContent ?? '').toBe(promotion.neighbor ?? '');
          fireEvent.keyDown(visual, {
            cancelable: true,
            ctrlKey: true,
            key: 'z',
            shiftKey: true
          });
          await waitFor(() => expect(owner.getValue()).toBe(remainder));
          await waitFor(() => expect(visual.querySelector('table')).toBeNull());
          await waitFor(() =>
            expect(visual.getAttribute('data-easymde-preview-phase')).toBe('ready')
          );
          expect(visual.getAttribute('contenteditable')).toBe('true');
          expect(owner.getHistoryState()).toEqual({
            undoDepth: historyBefore.undoDepth + 2,
            redoDepth: 0
          });
          expect(owner.getRevision?.()).toBe(revisionBefore + 4);
          expect(visual.querySelector('p')?.textContent ?? '').toBe(promotion.neighbor ?? '');
          expect(props.onFailure).not.toHaveBeenCalled();
        } finally {
          view.unmount();
          parts.restore();
        }
    }
  );

  /**
   * Open the promotion prerequisite for a cancellation run: settle the real
   * native deletion, hold the demanded Preview response and the genuine worker
   * inventory, issue ONE gesture, and return everything the two independent
   * continuation rows need.
   */
  async function openHeldPromotionDemand(
    promotion: PromotionCase,
    options: Readonly<{ retainFocus?: boolean }> = {}
  ) {
    const parts = tablePromotionFixture(promotion);
    const { props } = parts;
    const demandedIndex = observedBlockIndex(promotion.after);
    const heldPreview = deferred<PreviewResponse>();
    const heldIndex = deferred<EditorMarkdownBlockIndexData>();
    let holdDemandPreview = false;
    let holdDemandIndex = false;
    const indexPort: EditorMarkdownBlockIndexPort = {
      build: vi.fn(async ({ source }) => {
        if (holdDemandIndex && promotion.after === source) {
          return heldIndex.promise;
        }
        return observedBlockIndex(source);
      }),
      dispose: vi.fn()
    };
    // The named promotion shapes use the explicit fixture, exactly like the
    // positive groups; only a source it cannot name uses the shared builder.
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      holdDemandPreview && promotion.after === request.markdown
        ? heldPreview.promise
        : Promise.resolve(
            request.markdown === promotion.before
            || request.markdown === promotion.after
            || '' === request.markdown
              ? tablePromotionResponse(promotion, request)
              : promotionSourceResponse(request.markdown, request)
          )
    );
    const view = render(<EditorRoot {...props} editorBlockIndexPort={indexPort} />);
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
    layoutPreviewSurface(view.container);
    fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
    const visual = await view.findByRole('textbox', { name: '可视化文章编辑器' });
    await waitFor(() =>
      expect(visual.getAttribute('data-easymde-preview-phase')).toBe('ready')
    );
    const owner = parts.owner();
    if (!owner) throw new Error('cancel-promotion-owner-missing');
    // The pre-promotion source is ONE paragraph whose text is the complete
    // two-line source, and the deletion range lies inside it.
    const paragraphs = visual.querySelectorAll('p');
    expect(paragraphs).toHaveLength(promotion.neighbor ? 2 : 1);
    const paragraph = paragraphs[0]?.firstChild;
    if (!(paragraph instanceof Text)) {
      throw new Error('cancel-promotion-paragraph-missing');
    }
    expect(paragraph.data).toBe(promotion.before.split('\n\n')[0]);
    expect(owner.getValue()).toBe(promotion.before);
    expect(promotion.deletion.from).toBeGreaterThanOrEqual(0);
    expect(promotion.deletion.to).toBeLessThanOrEqual(paragraph.data.length);
    expect(promotion.deletion.to).toBeGreaterThan(promotion.deletion.from);
    nativeDelete(
      visual,
      paragraph,
      promotion.deletion.from,
      promotion.deletion.to
    );
    await waitFor(() => expect(owner.getValue()).toBe(promotion.after));
    const historyBefore = owner.getHistoryState();
    const revisionBefore = owner.getRevision?.();
    if (undefined === revisionBefore) throw new Error('cancel-promotion-revision-missing');
    expect(historyBefore).toEqual({ undoDepth: 1, redoDepth: 0 });
    const writesBefore = vi.mocked(props.editorClipboardPort.write).mock.calls
      .length;

    // The retained-focus oracle: this run owns the editor focus from before the
    // gesture onwards, and never repairs or repositions it later.
    const assertEditorFocus = (label: string): void => {
      expect(document.activeElement, label).toBe(visual);
      expect(visual.contains(document.activeElement), label).toBe(true);
    };
    if (options.retainFocus) {
      visual.focus();
      assertEditorFocus('before-held-gesture');
    }

    holdDemandPreview = true;
    holdDemandIndex = true;
    const oldParagraph = visual.querySelector('p');
    if (!(oldParagraph instanceof HTMLElement)) {
      throw new Error('cancel-promotion-paragraph-element-missing');
    }
    layoutContextMenuSurface(oldParagraph);
    // The baseline is captured BEFORE the gesture, so a request the gesture
    // issues synchronously is counted as the demand's own.
    const requestsBefore = demandRenders(
      vi.mocked(props.previewPort.render)
    ).length;
    fireEvent.pointerDown(oldParagraph, { button: 2, clientX: 20, clientY: 20 });
    fireEvent.contextMenu(oldParagraph, { clientX: 20, clientY: 20 });
    await waitFor(() =>
      expect(
        demandRenders(vi.mocked(props.previewPort.render)).length
      ).toBe(requestsBefore + 1)
    );
    await waitFor(() =>
      expect(
        vi.mocked(indexPort.build).mock.calls.some(
          ([request]) => request.source === promotion.after
        )
      ).toBe(true)
    );
    expect(within(document.body).queryAllByRole('menu')).toHaveLength(0);
    const demandRequest = vi.mocked(props.previewPort.render).mock.calls.at(-1)?.[0];
    if (!demandRequest) throw new Error('cancel-promotion-demand-missing');
    expect(demandRequest.markdown).toBe(promotion.after);

    /** Deliver both held prerequisites to the now-cancelled demand. */
    const deliverLate = async (): Promise<void> => {
      holdDemandPreview = false;
      holdDemandIndex = false;
      heldPreview.resolve(tablePromotionResponse(promotion, demandRequest));
      heldIndex.resolve(demandedIndex);
      await waitFor(() =>
        expect(visual.getAttribute('data-easymde-preview-phase')).toBe('ready')
      );
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });
    };
    return {
      assertEditorFocus,
      demandRequest,
      deliverLate,
      historyBefore,
      owner,
      parts,
      props,
      requestsBefore,
      revisionBefore,
      visual,
      view,
      writesBefore
    };
  }

  it.each([
    tablePromotion.equalInterior,
    tablePromotion.equalEof,
    tablePromotion.unequalInterior,
    tablePromotion.unequalEof,
    ...neighborPromotions
  ])(
    'cancels a $columns $region $scope promotion demand with retained focus, then continues editing at the mapped boundary',
    async (promotion: PromotionCase) => {
      // First independent run: the editor KEEPS focus across the cancellation
      // and the late acceptance. Nothing may reopen or act, the accepted table
      // must be in this root, the canonical and native boundary must be the
      // documented mapped index for an adopted table, and a continuation typed
      // there must commit exactly one history entry.
      const run = await openHeldPromotionDemand(promotion, { retainFocus: true });
      try {
        // Focus was already asserted in the shared setup, before the held
        // gesture. It must still hold immediately before the late delivery.
        run.assertEditorFocus('immediately-before-late-delivery');
        fireEvent.keyDown(document, { key: 'Escape' });
        await act(async () => {
          await Promise.resolve();
        });
        // Escape cancels the pending demand itself. A pending demand has no
        // visible menu, so the context-menu owner must consume that Escape
        // before the immersive owner sees it; otherwise the same key also exits
        // the mode and the late acceptance would have no editable surface.
        expect(run.visual.isConnected).toBe(true);
        expect(document.activeElement).toBe(run.visual);
        expect(run.visual.getAttribute('contenteditable')).toBe('true');
        await run.deliverLate();
        // The late acceptance must neither move focus nor leave a detached
        // surface behind: the same live, focused editor continues.
        expect(run.visual.isConnected).toBe(true);
        expect(
          document.querySelector('[aria-label="可视化文章编辑器"]')
        ).toBe(run.visual);
        expect(document.activeElement).toBe(run.visual);
        expect(within(document.body).queryAllByRole('menu')).toHaveLength(0);
        expect(within(document.body).queryByRole('menuitem', {
          name: 'Table'
        })).toBeNull();
        expect(vi.mocked(run.props.editorClipboardPort.write).mock.calls.length).toBe(
          run.writesBefore
        );
        expect(run.owner.getValue()).toBe(promotion.after);
        expect(run.owner.getHistoryState()).toEqual(run.historyBefore);
        expect(run.owner.getRevision?.()).toBe(run.revisionBefore);
        expect(run.parts.receiptResults.filter(Boolean)).toHaveLength(0);
        expect(run.props.onFailure).not.toHaveBeenCalled();
        expect(demandRenders(vi.mocked(run.props.previewPort.render))).toHaveLength(run.requestsBefore + 1);
        expect(run.visual.querySelector('p')?.textContent ?? '').toBe(promotion.neighbor ?? '');
        // The accepted table lives in THIS accepted root, and the documented
        // mapped boundary is index 0 - collapsed canonically and connected
        // natively inside the table, not the surface.
        const acceptedTable = run.visual.querySelector('table');
        if (!(acceptedTable instanceof HTMLTableElement)) {
          throw new Error('cancel-promotion-accepted-table-missing');
        }
        expect(run.visual.contains(acceptedTable)).toBe(true);
        // The approved presentation rule for an accepted changed-kind table
        // publishes the first nonempty editable Text unit inside that same
        // accepted root at offset 0. Both the canonical selection and the real
        // native caret must already be there, without any test-side focus or
        // Range repair.
        expect(run.owner.getSelection()).toEqual({
          direction: 'none',
          end: 0,
          start: 0
        });
        const surface = run.visual;
        const firstHeaderText = acceptedTable.querySelector('thead th')?.firstChild;
        if (!(firstHeaderText instanceof Text)) {
          throw new Error('cancel-promotion-first-header-missing');
        }
        const nativeSelection = window.getSelection();
        expect(nativeSelection?.rangeCount).toBe(1);
        expect(nativeSelection?.isCollapsed).toBe(true);
        expect(nativeSelection?.anchorNode).toBe(firstHeaderText);
        expect(nativeSelection?.anchorOffset).toBe(0);
        expect(nativeSelection?.focusNode).toBe(firstHeaderText);
        expect(nativeSelection?.focusOffset).toBe(0);
        expect(surface.contains(firstHeaderText)).toBe(true);

        // Typing at that boundary commits one byte at the canonical offset.
        const typed = new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          data: 'q',
          inputType: 'insertText'
        });
        surface.dispatchEvent(typed);
        if (!typed.defaultPrevented) {
          firstHeaderText.insertData(0, 'q');
        }
        surface.dispatchEvent(
          new InputEvent('input', {
            bubbles: true,
            data: 'q',
            inputType: 'insertText'
          })
        );
        const expectedTyped = `q${promotion.after}`;
        await waitFor(() => expect(run.owner.getValue()).toBe(expectedTyped));
        expect(run.owner.getRevision?.()).toBe(run.revisionBefore + 1);
        expect(run.owner.getSelection()).toEqual({
          direction: 'none',
          end: 1,
          start: 1
        });
        expect(run.owner.getHistoryState()).toEqual({
          redoDepth: 0,
          undoDepth: run.historyBefore.undoDepth + 1
        });
        await waitFor(() =>
          expect(surface.getAttribute('data-easymde-preview-phase')).toBe('ready')
        );
        // The typed source's own accepted shape follows the renderer's rule.
        expect(promotionTableShape(expectedTyped)).toBe(
          surface.querySelector('table') !== null
        );
        expect(surface.querySelector('p')?.textContent ?? '').toBe(promotion.neighbor ?? '');

        // Accepted Undo/Redo over the typed source.
        fireEvent.keyDown(surface, {
          cancelable: true,
          ctrlKey: true,
          key: 'z'
        });
        await waitFor(() => expect(run.owner.getValue()).toBe(promotion.after));
        await waitFor(() =>
          expect(surface.getAttribute('data-easymde-preview-phase')).toBe('ready')
        );
        expect(surface.getAttribute('contenteditable')).toBe('true');
        expect(run.owner.getRevision?.()).toBe(run.revisionBefore + 2);
        expect(surface.querySelector('p')?.textContent ?? '').toBe(promotion.neighbor ?? '');
        expect(run.owner.getHistoryState()).toEqual({
          redoDepth: 1,
          undoDepth: run.historyBefore.undoDepth
        });
        expect(run.owner.getSelection()).toEqual({
          direction: 'none',
          end: 0,
          start: 0
        });
        fireEvent.keyDown(surface, {
          cancelable: true,
          ctrlKey: true,
          key: 'z',
          shiftKey: true
        });
        await waitFor(() => expect(run.owner.getValue()).toBe(expectedTyped));
        await waitFor(() =>
          expect(surface.getAttribute('data-easymde-preview-phase')).toBe('ready')
        );
        expect(surface.getAttribute('contenteditable')).toBe('true');
        expect(run.owner.getRevision?.()).toBe(run.revisionBefore + 3);
        expect(surface.querySelector('p')?.textContent ?? '').toBe(promotion.neighbor ?? '');
        expect(run.props.onFailure).not.toHaveBeenCalled();
        expect(run.owner.getHistoryState()).toEqual({
          redoDepth: 0,
          undoDepth: run.historyBefore.undoDepth + 1
        });
        expect(run.owner.getSelection()).toEqual({
          direction: 'none',
          end: 1,
          start: 1
        });
      } finally {
        run.view.unmount();
        run.parts.restore();
      }
    }
  );

  it.each([
    tablePromotion.equalInterior,
    tablePromotion.equalEof,
    tablePromotion.unequalInterior,
    tablePromotion.unequalEof,
    ...neighborPromotions
  ])(
    'cancels a $columns $region $scope promotion demand while focus is outside, without reopening or stealing it',
    async (promotion: PromotionCase) => {
      // Second independent run: focus AND a real text selection are moved
      // OUTSIDE the editor while the response is still held, then both
      // prerequisites are delivered late. No caret inside the editor is required
      // before refocusing, and nothing may reopen, act, mutate, steal focus, or
      // move the outside selection.
      const run = await openHeldPromotionDemand(promotion);
      try {
        // A real outside editable host carrying selectable text.
        const outside = document.createElement('div');
        outside.contentEditable = 'true';
        // A real outside editable host is focusable; tabIndex makes that
        // explicit so the row does not depend on jsdom's contenteditable
        // focus heuristics.
        outside.tabIndex = 0;
        outside.textContent = 'outside host text';
        document.body.append(outside);
        try {
          // The outside host and its selection are established FIRST, as a real
          // user state, and then the demand is cancelled. Escape's own focus
          // handling must not move the user's outside focus or selection.
          outside.focus();
          expect(document.activeElement).toBe(outside);
          // A REAL outside text selection, established while held.
          const outsideText = outside.firstChild;
          if (!(outsideText instanceof Text)) {
            throw new Error('outside-focus-text-missing');
          }
          const outsideRange = document.createRange();
          outsideRange.setStart(outsideText, 0);
          outsideRange.setEnd(outsideText, 7);
          const outsideSelection = window.getSelection();
          outsideSelection?.removeAllRanges();
          outsideSelection?.addRange(outsideRange);
          expect(outsideSelection?.anchorNode).toBe(outsideText);
          expect(outsideSelection?.focusNode).toBe(outsideText);
          expect(outsideSelection?.anchorOffset).toBe(0);
          expect(outsideSelection?.focusOffset).toBe(7);

          fireEvent.keyDown(document, { key: 'Escape' });
          await act(async () => {
            await Promise.resolve();
          });
          expect(document.activeElement).toBe(outside);
          const snapshotSelection = () => {
            const selection = window.getSelection();
            return {
              rangeCount: selection?.rangeCount,
              anchorNode: selection?.anchorNode,
              focusNode: selection?.focusNode,
              anchorOffset: selection?.anchorOffset,
              focusOffset: selection?.focusOffset
            };
          };
          // Copy scalar offsets and Node identities, never alias the live Selection.
          const selectionAfterCancel = snapshotSelection();
          expect(selectionAfterCancel).toEqual({
            rangeCount: 1,
            anchorNode: outsideText,
            focusNode: outsideText,
            anchorOffset: 0,
            focusOffset: 7
          });
          await run.deliverLate();
          expect(run.parts.receiptResults.filter(Boolean)).toHaveLength(0);
          expect(run.parts.receiptPublications).toEqual([]);
          expect(run.visual.isConnected).toBe(true);
          expect(run.view.getByRole('textbox', { name: '可视化文章编辑器' })).toBe(run.visual);
          expect(run.visual.getAttribute('contenteditable')).toBe('true');
          const acceptedTable = run.visual.querySelector('table');
          if (!(acceptedTable instanceof HTMLTableElement)) {
            throw new Error('outside-cancel-promotion-accepted-table-missing');
          }
          expect(run.visual.contains(acceptedTable)).toBe(true);
          expect(Array.from(acceptedTable.querySelectorAll('thead > tr > th')).map((cell) => cell.textContent)).toEqual(
            'equal' === promotion.columns ? ['a', 'b'] : ['a', 'b', '']
          );
          expect(run.visual.querySelectorAll('p')).toHaveLength(promotion.neighbor ? 1 : 0);
          expect(run.visual.querySelector('p')?.textContent ?? '').toBe(promotion.neighbor ?? '');
          expect(within(document.body).queryAllByRole('menu')).toHaveLength(0);
          expect(within(document.body).queryByRole('menuitem', {
            name: 'Table'
          })).toBeNull();
          expect(
            vi.mocked(run.props.editorClipboardPort.write).mock.calls.length
          ).toBe(run.writesBefore);
          expect(run.owner.getValue()).toBe(promotion.after);
          expect(run.owner.getHistoryState()).toEqual(run.historyBefore);
          expect(run.owner.getRevision?.()).toBe(run.revisionBefore);
          expect(run.props.onFailure).not.toHaveBeenCalled();
          // Demand/session renders only: the menu's own `editor-code-content:`
          // query is a different, legitimate render kind and is excluded.
          expect(
            demandRenders(vi.mocked(run.props.previewPort.render)).length
          ).toBe(run.requestsBefore + 1);
          expect(document.activeElement).toBe(outside);
          expect(snapshotSelection()).toEqual(selectionAfterCancel);
          // A later mutation must disagree with the immutable baseline, proving
          // this oracle cannot pass by comparing the same live Selection alias.
          window.getSelection()?.collapse(outsideText, 2);
          expect(snapshotSelection()).not.toEqual(selectionAfterCancel);
        } finally {
          outside.remove();
        }
      } finally {
        run.view.unmount();
        run.parts.restore();
      }
    }
  );


  it('does not fabricate a selection for a held paste and copies only a deliberate pasted range', async () => {
    // A REAL clipboard paste legitimately writes the source, the revision, and
    // one history entry, and its Preview transfer is then held. The baseline for
    // the demand is therefore the POST-paste state, not the pre-paste one. The
    // gesture targets the RETAINED paragraph element - not the surface root -
    // and the demand itself must add nothing. The menu that finally opens is the
    // ORIGINAL resumed demand, and it performs its action directly, with no
    // replacement second gesture.
    const props = fixture();
    const initial = 'Rendered!';
    const pasted = 'Rendered!More';
    props.submissionField.value = initial;
    props.submissionField.defaultValue = initial;
    props.submissionField.setSelectionRange(initial.length, initial.length);
    const held = deferred<PreviewResponse>();
    const responseFor = (request: PreviewRequest): PreviewResponse => ({
      editMap: {
        blocks: [
          {
            editable: true,
            endLine: request.markdown.split('\n').length,
            id: 'b0',
            startLine: 0
          }
        ],
        coordinate: 'line' as const,
        signature: request.signature,
        version: 1 as const
      },
      features: {},
      html: (
        `<p data-easymde-visual-block-id="b0">${request.markdown}</p>`
      ) as SafePreviewHtml
    });
    let holdTransfer = false;
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      holdTransfer && request.markdown === pasted
        ? held.promise
        : Promise.resolve(responseFor(request))
    );
    const realCreateDocumentSession =
      observedSourceAdapter.createCodeMirrorDocumentSession;
    const ownerRef: {
      current: ReturnType<typeof realCreateDocumentSession> | null;
    } = { current: null };
    const sessionSpy = vi
      .spyOn(observedSourceAdapter, 'createCodeMirrorDocumentSession')
      .mockImplementation((session) => {
        const owner = realCreateDocumentSession(session);
        ownerRef.current = owner;
        return owner;
      });
    const view = render(<EditorRoot {...props} />);
    try {
      fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
      fireEvent.click(view.getByRole('button', { name: '预览' }));
      await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
      layoutPreviewSurface(view.container);
      fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
      const visual = await view.findByRole('textbox', { name: '可视化文章编辑器' });
      await waitFor(() =>
        expect(visual.getAttribute('data-easymde-preview-phase')).toBe('ready')
      );
      const owner = ownerRef.current;
      if (!owner) throw new Error('held-paste-owner-missing');
      const retainedParagraph = visual.querySelector('p');
      const paragraphText = retainedParagraph?.firstChild;
      if (!(retainedParagraph instanceof HTMLElement)
        || !(paragraphText instanceof Text)) {
        throw new Error('held-paste-paragraph-missing');
      }
      visual.focus();
      const caret = document.createRange();
      caret.setStart(paragraphText, paragraphText.data.length);
      caret.collapse(true);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(caret);
      const historyBeforePaste = owner.getHistoryState();
      const revisionBeforePaste = owner.getRevision?.();

      // The real paste owner path, with its formal transfer held.
      holdTransfer = true;
      const requestsBefore = vi.mocked(props.previewPort.render).mock.calls.length;
      fireEvent.paste(visual, {
        clipboardData: {
          getData: (type: string) => ('text/plain' === type ? 'More' : ''),
          types: ['text/plain']
        }
      });
      await waitFor(() => expect(props.submissionField.value).toBe(pasted));
      await waitFor(() =>
        expect(visual.getAttribute('data-easymde-preview-phase')).not.toBe('ready')
      );
      expect(vi.mocked(props.previewPort.render).mock.calls.length).toBe(
        requestsBefore + 1
      );
      const heldRequest = vi
        .mocked(props.previewPort.render)
        .mock.calls.at(-1)?.[0];
      expect(heldRequest?.markdown).toBe(pasted);
      // The paste is a REAL user write: the POST-paste state is the baseline.
      const historyAfterPaste = owner.getHistoryState();
      const revisionAfterPaste = owner.getRevision?.();
      expect(historyAfterPaste.undoDepth).toBe(historyBeforePaste.undoDepth + 1);
      expect(revisionAfterPaste).not.toBe(revisionBeforePaste);
      expect(owner.getValue()).toBe(pasted);
      // The accepted DOM still shows the pre-paste text while held, and the
      // element the user points at is that same retained paragraph.
      expect(retainedParagraph.isConnected).toBe(true);
      expect(retainedParagraph.textContent).toBe(initial);

      // The gesture targets the RETAINED PARAGRAPH, never the surface root.
      layoutContextMenuSurface(retainedParagraph);
      fireEvent.pointerDown(retainedParagraph, {
        button: 2,
        clientX: 20,
        clientY: 20
      });
      fireEvent.contextMenu(retainedParagraph, { clientX: 20, clientY: 20 });
      await act(async () => {
        await Promise.resolve();
      });
      // No second authentication request and no menu yet, and the demand itself
      // added no mutation on top of the paste.
      expect(vi.mocked(props.previewPort.render).mock.calls.length).toBe(
        requestsBefore + 1
      );
      expect(within(document.body).queryAllByRole('menu')).toHaveLength(0);
      expect(owner.getValue()).toBe(pasted);
      expect(owner.getHistoryState()).toEqual(historyAfterPaste);
      expect(owner.getRevision?.()).toBe(revisionAfterPaste);
      expect(vi.mocked(props.editorClipboardPort.write)).not.toHaveBeenCalled();

      if (!heldRequest) throw new Error('held-paste-request-missing');
      // Disarm the held transfer: the action's own refresh must get a FRESH
      // response for its own request.
      holdTransfer = false;
      held.resolve(responseFor(heldRequest));
      // This is the ORIGINAL resumed demand's menu, not a replacement gesture.
      await waitFor(
        () =>
          expect(within(document.body).queryAllByRole('menu')).toHaveLength(1),
        { timeout: 5000 }
      );
      expect(vi.mocked(props.previewPort.render).mock.calls.length).toBe(
        requestsBefore + 1
      );
      // The retained paragraph is retired, and the fresh accepted DOM shows the
      // pasted bytes.
      expect(retainedParagraph.isConnected).toBe(false);
      expect(visual.querySelector('p')?.textContent).toBe(pasted);
      const acceptedRevision = owner.getRevision?.();
      expect(owner.getHistoryState().undoDepth).toBe(historyAfterPaste.undoDepth);

      // The resumed menu is the ORIGINAL demand's, and for a HELD PASTE the
      // captured selection is collapsed. The Full owner must not widen a
      // collapsed capture into a whole block (that would copy bytes the user did
      // not select), so the generic Copy is correctly DISABLED here and the
      // handler writes nothing.
      const resumedMenu = within(document.body).getByRole('menu');
      const collapsedCopy = within(resumedMenu).getByRole('menuitem', {
        name: /^Copy$/
      });
      expect(collapsedCopy.getAttribute('aria-disabled')).toBe('true');
      fireEvent.click(collapsedCopy);
      await act(async () => {
        await Promise.resolve();
      });
      expect(props.editorClipboardPort.write).not.toHaveBeenCalled();
      // Clicking a disabled item performs no action, so the menu stays open and
      // nothing is fabricated; the canonical document and history are untouched.
      expect(owner.getValue()).toBe(pasted);
      expect(owner.getRevision?.()).toBe(acceptedRevision);
      expect(owner.getHistoryState().undoDepth).toBe(historyAfterPaste.undoDepth);
      expect(props.submissionField.value).toBe(pasted);

      // A DELIBERATE range over the pasted block is a real user selection, and
      // that CAN be copied: the demand publishes exactly its extent.
      const acceptedParagraph = visual.querySelector('p');
      if (!(acceptedParagraph instanceof HTMLElement)) {
        throw new Error('held-paste-accepted-paragraph-missing');
      }
      const deliberateRange = document.createRange();
      deliberateRange.selectNodeContents(acceptedParagraph);
      const deliberateSelection = window.getSelection();
      deliberateSelection?.removeAllRanges();
      deliberateSelection?.addRange(deliberateRange);
      layoutContextMenuSurface(acceptedParagraph);
      fireEvent.pointerDown(acceptedParagraph, {
        button: 2,
        clientX: 20,
        clientY: 20
      });
      fireEvent.contextMenu(acceptedParagraph, { clientX: 20, clientY: 20 });
      await waitFor(() =>
        expect(within(document.body).queryAllByRole('menu')).toHaveLength(1)
      );
      const deliberateMenu = within(document.body).getByRole('menu');
      const deliberateCopy = within(deliberateMenu).getByRole('menuitem', {
        name: /^Copy$/
      });
      expect(deliberateCopy.getAttribute('aria-disabled')).toBe('false');
      // The published range is the whole pasted block.
      expect(owner.getSelection()).toEqual({
        direction: 'forward',
        end: pasted.length,
        start: 0
      });
      fireEvent.click(deliberateCopy);
      await waitFor(() =>
        expect(props.editorClipboardPort.write).toHaveBeenCalledWith(pasted)
      );
      // Copy is a pure read in both cases: no source, revision or history write.
      expect(owner.getValue()).toBe(pasted);
      expect(owner.getRevision?.()).toBe(acceptedRevision);
      expect(owner.getHistoryState().undoDepth).toBe(historyAfterPaste.undoDepth);
      expect(props.submissionField.value).toBe(pasted);
      expect(props.onFailure).not.toHaveBeenCalled();
    } finally {
      view.unmount();
      sessionSpy.mockRestore();
    }
  });

  it('keeps a stale protected generated identity through one refresh and deletes the current formula', async () => {
    // The approved control: a native edit in the BEFORE paragraph. The initial
    // source `Before\n\n$x$\n\nAfter` owns the formula at [8,11); typing `q` at
    // the end of `Before` commits `Beforeq\n\n$x$\n\nAfter`, so the formula now
    // occupies [9,12) and the trailing `After` paragraph is source line 4.
    const sourceMarkdown = 'Before\n\n$x$\n\nAfter';
    const typedMarkdown = 'Beforeq\n\n$x$\n\nAfter';
    const initialFormula = sourceMarkdown.indexOf('$x$');
    expect([initialFormula, initialFormula + 3]).toEqual([8, 11]);
    const typedFormula = typedMarkdown.indexOf('$x$');
    expect([typedFormula, typedFormula + 3]).toEqual([9, 12]);
    expect(typedMarkdown.split('\n').indexOf('After')).toBe(4);
    const deleted = 'Beforeq\n\n\n\nAfter';
    // The fixture for THIS row: the source is the initial two-paragraph formula
    // document, and the canonical owner observes the real session.
    const props = fixture();
    props.submissionField.value = sourceMarkdown;
    props.submissionField.defaultValue = sourceMarkdown;
    props.submissionField.setSelectionRange(0, 0);
    /**
     * Truthful HTML and edit map for every state this row can request: the
     * initial paragraph+formula source, the typed source, the deleted source
     * (which no longer contains `$x$` at all), and the history-restored states.
     * Blank separator lines are not blocks.
     */
    const responseForSource = (markdown: string): SafePreviewHtml => {
      const lines = markdown.split('\n');
      const html: string[] = [];
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index] ?? '';
        if ('' === line) continue;
        const id = `b${html.length}`;
        html.push(
          '$x$' === line
            ? `<p data-easymde-visual-block-id="${id}"><span class="easymde-math easymde-math-inline"><span class="katex"><span class="katex-mathml"><math><mi>x</mi></math></span></span></span></p>`
            : `<p data-easymde-visual-block-id="${id}">${line}</p>`
        );
      }
      return html.join('') as SafePreviewHtml;
    };
    const editMapFor = (request: PreviewRequest) => {
      const lines = request.markdown.split('\n');
      const blocks: Array<{
        editable: true;
        endLine: number;
        id: string;
        startLine: number;
      }> = [];
      for (let index = 0; index < lines.length; index += 1) {
        if ('' === (lines[index] ?? '')) continue;
        blocks.push({
          editable: true,
          endLine: index + 1,
          id: `b${blocks.length}`,
          startLine: index
        });
      }
      return {
        blocks,
        coordinate: 'line' as const,
        signature: request.signature,
        version: 1 as const
      };
    };
    const hasFormula = (markdown: string): boolean =>
      markdown.split('\n').includes('$x$');
    const responseFor = (request: PreviewRequest): PreviewResponse => ({
      editMap: editMapFor(request),
      features: hasFormula(request.markdown) ? { math: true } : {},
      html: responseForSource(request.markdown)
    });
    // The REAL worker inventory, derived from the producer for whatever source
    // it is asked about; only the demanded refresh holds it.
    const heldIndex = deferred<EditorMarkdownBlockIndexData>();
    let holdDemandIndex = false;
    const indexPort: EditorMarkdownBlockIndexPort = {
      build: vi.fn(async ({ source }) => {
        if (holdDemandIndex && typedMarkdown === source) {
          return heldIndex.promise;
        }
        return observedBlockIndex(source);
      }),
      dispose: vi.fn()
    };
    const heldRefresh = deferred<PreviewResponse>();
    let holdRefresh = false;
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      holdRefresh && typedMarkdown === request.markdown
        ? heldRefresh.promise
        : Promise.resolve(responseFor(request))
    );
    const generatedContentExportSession = {
      copyAsImage: vi.fn().mockResolvedValue({ status: 'copied' as const }),
      copyMathMl: vi.fn().mockResolvedValue({ status: 'copied' as const }),
      dispose: vi.fn()
    } as GeneratedContentExportSession;
    const realCreateDocumentSession =
      observedSourceAdapter.createCodeMirrorDocumentSession;
    const ownerRef: {
      current: ReturnType<typeof realCreateDocumentSession> | null;
    } = { current: null };
    const sessionSpy = vi
      .spyOn(observedSourceAdapter, 'createCodeMirrorDocumentSession')
      .mockImplementation((session) => {
        const owner = realCreateDocumentSession(session);
        ownerRef.current = owner;
        return owner;
      });
    const view = render(
      <EditorRoot
        {...props}
        editorBlockIndexPort={indexPort}
        generatedContentExportSession={generatedContentExportSession}
      />
    );
    try {
      fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
      fireEvent.click(view.getByRole('button', { name: '预览' }));
      await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
      layoutPreviewSurface(view.container);
      fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
      const visual = await view.findByRole('textbox', { name: '可视化文章编辑器' });
      await waitFor(() =>
        expect(visual.getAttribute('data-easymde-preview-phase')).toBe('ready')
      );
      const owner = ownerRef.current;
      if (!owner) throw new Error('protected-identity-owner-missing');
      const staleMath = visual.querySelector('.easymde-math');
      const beforeText = visual.querySelector('p')?.firstChild;
      if (!(staleMath instanceof HTMLElement) || !(beforeText instanceof Text)) {
        throw new Error('protected-identity-dom-missing');
      }
      expect(owner.getValue()).toBe(sourceMarkdown);

      // The approved control: a REAL native character typed at the end of the
      // BEFORE paragraph, which shifts the formula one byte later.
      visual.focus();
      const caret = document.createRange();
      caret.setStart(beforeText, beforeText.data.length);
      caret.collapse(true);
      const nativeSelection = window.getSelection();
      nativeSelection?.removeAllRanges();
      nativeSelection?.addRange(caret);
      const typedEvent = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        data: 'q',
        inputType: 'insertText'
      });
      visual.dispatchEvent(typedEvent);
      if (!typedEvent.defaultPrevented) {
        beforeText.insertData(beforeText.data.length, 'q');
      }
      visual.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          data: 'q',
          inputType: 'insertText'
        })
      );
      await waitFor(() => expect(owner.getValue()).toBe(typedMarkdown));
      const historyBefore = owner.getHistoryState();
      const revisionBefore = owner.getRevision?.();
      expect(revisionBefore).not.toBeUndefined();
      expect(historyBefore.undoDepth).toBeGreaterThan(0);

      // ONE gesture on the now-STALE formula element, with the refresh and the
      // worker inventory both held.
      holdRefresh = true;
      holdDemandIndex = true;
      const requestsBefore = vi.mocked(props.previewPort.render).mock.calls.length;
      layoutContextMenuSurface(staleMath);
      fireEvent.pointerDown(staleMath, { button: 2, clientX: 24, clientY: 30 });
      fireEvent.contextMenu(staleMath, { clientX: 24, clientY: 30 });

      // Exactly one formal request, for the typed source.
      await waitFor(() =>
        expect(vi.mocked(props.previewPort.render).mock.calls.length).toBe(
          requestsBefore + 1
        )
      );
      expect(
        vi.mocked(props.previewPort.render).mock.calls.at(-1)?.[0].markdown
      ).toBe(typedMarkdown);
      const demandRequest = vi.mocked(props.previewPort.render).mock.calls.at(-1)?.[0];
      if (!demandRequest) throw new Error('protected-identity-demand-missing');
      // The worker really builds the genuine inventory for the TYPED source.
      await waitFor(() =>
        expect(
          vi.mocked(indexPort.build).mock.calls.some(
            ([request]) => request.source === typedMarkdown
          )
        ).toBe(true)
      );
      await act(async () => {
        await Promise.resolve();
      });
      // While either prerequisite is outstanding: no menu, no Formula submenu,
      // and nothing touched the document, history, or Clipboard.
      expect(within(document.body).queryAllByRole('menu')).toHaveLength(0);
      expect(within(document.body).queryByRole('menuitem', {
        name: 'Formula'
      })).toBeNull();
      expect(owner.getValue()).toBe(typedMarkdown);
      expect(owner.getHistoryState()).toEqual(historyBefore);

      // Deliver the fresh real Preview: the worker inventory is still held, so
      // the demand must still not open or act on the stale identity.
      heldRefresh.resolve(responseFor(demandRequest));
      await waitFor(() =>
        expect(visual.getAttribute('data-easymde-preview-phase')).toBe('ready')
      );
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(within(document.body).queryAllByRole('menu')).toHaveLength(0);
      expect(within(document.body).queryByRole('menuitem', {
        name: 'Formula'
      })).toBeNull();
      // The fresh accepted Preview really replaced the protected identity.
      expect(staleMath.isConnected).toBe(false);
      expect(visual.querySelector('.easymde-math')).not.toBeNull();
      expect(owner.getValue()).toBe(typedMarkdown);
      expect(owner.getHistoryState()).toEqual(historyBefore);

      // Deliver the genuine worker result for exactly the typed source: the
      // lease now authenticates [9,12) in the CURRENT source.
      holdDemandIndex = false;
      heldIndex.resolve(observedBlockIndex(typedMarkdown));
      await waitFor(
        () =>
          expect(within(document.body).queryAllByRole('menu')).toHaveLength(1),
        { timeout: 5000 }
      );
      // Disarm the held refresh: the deletion and each history refresh must get
      // a FRESH response for their own request, never this obsolete one.
      holdRefresh = false;
      expect(vi.mocked(props.previewPort.render).mock.calls.length).toBe(
        requestsBefore + 1
      );
      expect(owner.getValue()).toBe(typedMarkdown);
      expect(owner.getHistoryState()).toEqual(historyBefore);

      // The actual Formula submenu, through the generated handler.
      const menu = within(document.body).getByRole('menu');
      const trigger = within(menu).getByRole('menuitem', { name: 'Formula' });
      fireEvent.pointerDown(trigger, { button: 0 });
      fireEvent.click(trigger);
      const formulaMenu = await within(document.body).findByRole('menu', {
        name: 'Formula'
      });
      const deleteFormula = within(formulaMenu).getByRole('menuitem', {
        name: 'Delete'
      });
      expect(deleteFormula.getAttribute('aria-disabled')).toBe('false');
      fireEvent.click(deleteFormula);
      // The generated handler removes exactly the CURRENT formula bytes at
      // [9,12), preserving the blank lines and both paragraphs.
      await waitFor(() => expect(owner.getValue()).toBe(deleted));
      expect(owner.getValue().split('\n')).toEqual([
        'Beforeq',
        '',
        '',
        '',
        'After'
      ]);
      expect(owner.getHistoryState().undoDepth).toBe(historyBefore.undoDepth + 1);
      // The generated deletion's own ACCEPTED presentation must land first: no
      // formula remains in the accepted DOM and the surface is ready/editable.
      await waitFor(() => expect(visual.querySelector('.easymde-math')).toBeNull());
      await waitFor(() =>
        expect(visual.getAttribute('data-easymde-preview-phase')).toBe('ready')
      );
      expect(visual.getAttribute('contenteditable')).toBe('true');
      expect(owner.getValue()).toBe(deleted);

      // Native history over the real document: Undo restores the typed source
      // with its accepted formula, Redo completes the deletion again - each
      // behind its own accepted readiness/editability barrier.
      fireEvent.keyDown(visual, { cancelable: true, ctrlKey: true, key: 'z' });
      await waitFor(() => expect(owner.getValue()).toBe(typedMarkdown));
      await waitFor(() => expect(visual.querySelector('.easymde-math')).not.toBeNull());
      await waitFor(() =>
        expect(visual.getAttribute('data-easymde-preview-phase')).toBe('ready')
      );
      expect(visual.getAttribute('contenteditable')).toBe('true');
      fireEvent.keyDown(visual, {
        cancelable: true,
        ctrlKey: true,
        key: 'z',
        shiftKey: true
      });
      await waitFor(() => expect(owner.getValue()).toBe(deleted));
      await waitFor(() => expect(visual.querySelector('.easymde-math')).toBeNull());
      await waitFor(() =>
        expect(visual.getAttribute('data-easymde-preview-phase')).toBe('ready')
      );
      expect(visual.getAttribute('contenteditable')).toBe('true');
      expect(props.onFailure).not.toHaveBeenCalled();
    } finally {
      view.unmount();
      sessionSpy.mockRestore();
    }
  });

  it('retires a stale protected identity that the user changes again, and a later gesture still acts', async () => {
    // The delayed/stale negative beside the B2 positive: the SAME approved
    // control creates the stale identity, but the user types again before the
    // demanded refresh settles. The authenticated identity then no longer
    // describes the current source, so the demand must retire without acting,
    // without a stale action, and without spamming failures - and a later
    // truthful gesture must still work.
    const sourceMarkdown = 'Before\n\n$x$\n\nAfter';
    const firstTyped = 'Beforeq\n\n$x$\n\nAfter';
    const secondTyped = 'Beforeqq\n\n$x$\n\nAfter';
    expect(firstTyped.indexOf('$x$') + 3).toBe(12);
    expect(secondTyped.indexOf('$x$') + 3).toBe(13);
    const props = fixture();
    props.submissionField.value = sourceMarkdown;
    props.submissionField.defaultValue = sourceMarkdown;
    props.submissionField.setSelectionRange(0, 0);
    /** Truthful HTML and map for any of this row's source states. */
    const responseFor = (request: PreviewRequest): PreviewResponse => {
      const lines = request.markdown.split('\n');
      const html: string[] = [];
      const blocks: Array<{
        editable: true;
        endLine: number;
        id: string;
        startLine: number;
      }> = [];
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index] ?? '';
        if ('' === line) continue;
        const id = `b${blocks.length}`;
        blocks.push({
          editable: true,
          endLine: index + 1,
          id,
          startLine: index
        });
        html.push(
          '$x$' === line
            ? `<p data-easymde-visual-block-id="${id}"><span class="easymde-math easymde-math-inline"><span class="katex"><span class="katex-mathml"><math><mi>x</mi></math></span></span></span></p>`
            : `<p data-easymde-visual-block-id="${id}">${line}</p>`
        );
      }
      return {
        editMap: {
          blocks,
          coordinate: 'line' as const,
          signature: request.signature,
          version: 1 as const
        },
        features: request.markdown.split('\n').includes('$x$')
          ? { math: true }
          : {},
        html: html.join('') as SafePreviewHtml
      };
    };
    const indexPort: EditorMarkdownBlockIndexPort = {
      build: vi.fn(async ({ source }) => observedBlockIndex(source)),
      dispose: vi.fn()
    };
    // Only the FIRST typed source's refresh is held, so the second typing
    // happens while that refresh is genuinely outstanding.
    const heldRefresh = deferred<PreviewResponse>();
    let holdRefresh = false;
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      holdRefresh && firstTyped === request.markdown
        ? heldRefresh.promise
        : Promise.resolve(responseFor(request))
    );
    const generatedContentExportSession = {
      copyAsImage: vi.fn().mockResolvedValue({ status: 'copied' as const }),
      copyMathMl: vi.fn().mockResolvedValue({ status: 'copied' as const }),
      dispose: vi.fn()
    } as GeneratedContentExportSession;
    const realCreateDocumentSession =
      observedSourceAdapter.createCodeMirrorDocumentSession;
    const ownerRef: {
      current: ReturnType<typeof realCreateDocumentSession> | null;
    } = { current: null };
    const sessionSpy = vi
      .spyOn(observedSourceAdapter, 'createCodeMirrorDocumentSession')
      .mockImplementation((session) => {
        const owner = realCreateDocumentSession(session);
        ownerRef.current = owner;
        return owner;
      });
    const view = render(
      <EditorRoot
        {...props}
        editorBlockIndexPort={indexPort}
        generatedContentExportSession={generatedContentExportSession}
      />
    );
    try {
      fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
      fireEvent.click(await view.findByRole('button', { name: '预览' }));
      await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
      layoutPreviewSurface(view.container);
      fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
      const visual = await view.findByRole('textbox', { name: '可视化文章编辑器' });
      await waitFor(() =>
        expect(visual.getAttribute('data-easymde-preview-phase')).toBe('ready')
      );
      const owner = ownerRef.current;
      if (!owner) throw new Error('stale-negative-owner-missing');
      const beforeText = (): Text => {
        const node = visual.querySelector('p')?.firstChild;
        if (!(node instanceof Text)) {
          throw new Error('stale-negative-before-text-missing');
        }
        return node;
      };
      const typeIntoBefore = (character: string): void => {
        const node = beforeText();
        const range = document.createRange();
        range.setStart(node, node.data.length);
        range.collapse(true);
        const nativeSelection = window.getSelection();
        nativeSelection?.removeAllRanges();
        nativeSelection?.addRange(range);
        const typed = new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          data: character,
          inputType: 'insertText'
        });
        visual.dispatchEvent(typed);
        if (!typed.defaultPrevented) {
          node.insertData(node.data.length, character);
        }
        visual.dispatchEvent(
          new InputEvent('input', {
            bubbles: true,
            data: character,
            inputType: 'insertText'
          })
        );
      };
      visual.focus();
      typeIntoBefore('q');
      await waitFor(() => expect(owner.getValue()).toBe(firstTyped));
      const staleMath = visual.querySelector('.easymde-math');
      if (!(staleMath instanceof HTMLElement)) {
        throw new Error('stale-negative-math-missing');
      }
      const writesBefore = vi.mocked(props.editorClipboardPort.write).mock.calls
        .length;

      holdRefresh = true;
      const requestsBefore = vi.mocked(props.previewPort.render).mock.calls.length;
      layoutContextMenuSurface(staleMath);
      fireEvent.pointerDown(staleMath, { button: 2, clientX: 24, clientY: 30 });
      fireEvent.contextMenu(staleMath, { clientX: 24, clientY: 30 });
      // The held request must be observed BEFORE the obsolete response is
      // delivered, so this is a real hold and not a race.
      await waitFor(() =>
        expect(vi.mocked(props.previewPort.render).mock.calls.length).toBe(
          requestsBefore + 1
        )
      );
      const heldRequest = vi.mocked(props.previewPort.render).mock.calls.at(-1)?.[0];
      if (!heldRequest) throw new Error('stale-negative-demand-missing');
      expect(heldRequest.markdown).toBe(firstTyped);

      // The user types again while that refresh is outstanding.
      typeIntoBefore('q');
      await waitFor(() => expect(owner.getValue()).toBe(secondTyped));
      const historyAfterSecondTyping = owner.getHistoryState();

      // Deliver the now-obsolete response: nothing may act on it.
      heldRefresh.resolve(responseFor(heldRequest));
      holdRefresh = false;
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(within(document.body).queryAllByRole('menu')).toHaveLength(0);
      expect(vi.mocked(props.editorClipboardPort.write).mock.calls.length).toBe(
        writesBefore
      );
      expect(owner.getValue()).toBe(secondTyped);
      expect(owner.getHistoryState().undoDepth).toBe(
        historyAfterSecondTyping.undoDepth
      );

      // A later truthful gesture on the current accepted formula still acts.
      await waitFor(() =>
        expect(visual.getAttribute('data-easymde-preview-phase')).toBe('ready')
      );
      const currentMath = visual.querySelector('.easymde-math');
      if (!(currentMath instanceof HTMLElement)) {
        throw new Error('stale-negative-current-math-missing');
      }
      layoutContextMenuSurface(currentMath);
      fireEvent.pointerDown(currentMath, { button: 2, clientX: 24, clientY: 30 });
      fireEvent.contextMenu(currentMath, { clientX: 24, clientY: 30 });
      // The later gesture's menu is awaited explicitly and then read with
      // `getByRole`, so an obsolete response can never be credited with opening
      // it and no implicit retry window is added.
      await waitFor(
        () => expect(within(document.body).queryAllByRole('menu')).toHaveLength(1)
      );
      const menu = within(document.body).getByRole('menu');
      const trigger = within(menu).getByRole('menuitem', { name: 'Formula' });
      fireEvent.pointerDown(trigger, { button: 0 });
      fireEvent.click(trigger);
      await waitFor(() =>
        expect(
          within(document.body).queryAllByRole('menu', { name: 'Formula' })
        ).toHaveLength(1)
      );
      const formulaMenu = within(document.body).getByRole('menu', {
        name: 'Formula'
      });
      fireEvent.click(
        within(formulaMenu).getByRole('menuitem', { name: 'Delete' })
      );
      const afterDelete = 'Beforeqq\n\n\n\nAfter';
      await waitFor(() => expect(owner.getValue()).toBe(afterDelete));
      expect(owner.getHistoryState().undoDepth).toBe(
        historyAfterSecondTyping.undoDepth + 1
      );
    } finally {
      view.unmount();
      sessionSpy.mockRestore();
    }
  });

  it('acts on the surviving second HR after the first is deleted under a held transfer', async () => {
    // Two identical HRs. The canonical operation deletes exactly the FIRST one
    // at [8,11) - the three dashes - and the surviving second HR keeps its own
    // current source position, so old IDs cannot decide which HR the user
    // pointed at.
    const props = fixture();
    const initial = 'before\n\n---\n\nmid\n\n---\n\nafter';
    // The HR command removes exactly the addressed block range - the three
    // dashes - and leaves the surrounding separators in place. The literal
    // bytes are asserted so a wrong length cannot slip in.
    expect(initial.slice(8, 11)).toBe('---');
    const afterFirstDeletion = initial.slice(0, 8) + initial.slice(11);
    expect(afterFirstDeletion).toBe('before\n\n\n\nmid\n\n---\n\nafter');
    props.submissionField.value = initial;
    props.submissionField.defaultValue = initial;
    const held = deferred<PreviewResponse>();
    /**
     * Explicit, line-indexed blocks with the real HTML. Blank separator lines
     * are not blocks: the preserved gap after the first HR must not become an
     * empty rendered paragraph, which is exactly what a `split('\n\n')`
     * projection would have manufactured.
     */
    const responseFor = (request: PreviewRequest): PreviewResponse => {
      const lines = request.markdown.split('\n');
      const blocks: Array<{
        editable: true;
        endLine: number;
        id: string;
        startLine: number;
      }> = [];
      const html: string[] = [];
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index] ?? '';
        if ('' === line) continue;
        const id = `b${blocks.length}`;
        blocks.push({
          editable: true,
          endLine: index + 1,
          id,
          startLine: index
        });
        html.push(
          '---' === line
            ? `<hr data-easymde-visual-block-id="${id}">`
            : `<p data-easymde-visual-block-id="${id}">${line}</p>`
        );
      }
      return {
        editMap: {
          blocks,
          coordinate: 'line' as const,
          signature: request.signature,
          version: 1 as const
        },
        features: {},
        html: html.join('') as SafePreviewHtml
      };
    };
    let holdTransfer = false;
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      holdTransfer && request.markdown === afterFirstDeletion
        ? held.promise
        : Promise.resolve(responseFor(request))
    );
    const realCreateDocumentSession =
      observedSourceAdapter.createCodeMirrorDocumentSession;
    const ownerRef: {
      current: ReturnType<typeof realCreateDocumentSession> | null;
    } = { current: null };
    const sessionSpy = vi
      .spyOn(observedSourceAdapter, 'createCodeMirrorDocumentSession')
      .mockImplementation((session) => {
        const owner = realCreateDocumentSession(session);
        ownerRef.current = owner;
        return owner;
      });
    const view = render(<EditorRoot {...props} />);
    try {
      fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
      fireEvent.click(view.getByRole('button', { name: '预览' }));
      await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
      layoutPreviewSurface(view.container);
      fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
      const visual = await view.findByRole('textbox', { name: '可视化文章编辑器' });
      await waitFor(() =>
        expect(visual.getAttribute('data-easymde-preview-phase')).toBe('ready')
      );
      const owner = ownerRef.current;
      if (!owner) throw new Error('second-hr-owner-missing');
      const breaks = visual.querySelectorAll('hr');
      expect(breaks).toHaveLength(2);
      const surviving = breaks[1];
      if (!(surviving instanceof HTMLElement)) {
        throw new Error('second-hr-missing');
      }
      const requestsBefore = vi.mocked(props.previewPort.render).mock.calls.length;
      const historyBefore = owner.getHistoryState();
      const revisionBefore = owner.getRevision?.();

      // The REAL owner operation that deletes the first HR, held in its
      // transfer: an actual canonical deletion of [8,11) - the three dashes -
      // not a synthetic value swap, and the transfer carries exactly the source
      // the owner reports.
      holdTransfer = true;
      const firstBreak = visual.querySelector('hr');
      if (!(firstBreak instanceof HTMLElement)) throw new Error('first-hr-missing');
      // The user removes the FIRST HR through the editor's own delete command
      // for that root, which consumes the first HR's native range.
      layoutContextMenuSurface(firstBreak);
      fireEvent.pointerDown(firstBreak, { button: 2, clientX: 20, clientY: 20 });
      fireEvent.contextMenu(firstBreak, { clientX: 20, clientY: 20 });
      const firstMenu = await within(document.body).findByRole('menu');
      fireEvent.click(
        within(firstMenu).getByRole('menuitem', {
          name: 'Delete horizontal rule'
        })
      );
      await waitFor(() =>
        expect(props.submissionField.value).toBe(afterFirstDeletion)
      );
      await waitFor(() =>
        expect(visual.getAttribute('data-easymde-preview-phase')).not.toBe('ready')
      );
      // The old DOM is still mounted: both HRs are still present.
      expect(visual.querySelectorAll('hr')).toHaveLength(2);
      const firstDeletionHistory = owner.getHistoryState();
      expect(firstDeletionHistory.undoDepth).toBe(historyBefore.undoDepth + 1);
      // The owner commits the nearest surviving EDITABLE boundary rather than
      // the raw start of the removed range: after removing the three dashes the
      // preserved blank run is not editable, so the following block's first
      // character (index 10, the `m` of `mid`) is the mountable position.
      expect(afterFirstDeletion[10]).toBe('m');
      expect(owner.getSelection()).toEqual({
        direction: 'none',
        end: 10,
        start: 10
      });

      // Exactly ONE request, for exactly the first-deletion source.
      expect(vi.mocked(props.previewPort.render).mock.calls.length).toBe(
        requestsBefore + 1
      );
      const heldRequest = vi
        .mocked(props.previewPort.render)
        .mock.calls.at(-1)?.[0];
      if (!heldRequest) throw new Error('held-hr-request-missing');
      expect(heldRequest.markdown).toBe(afterFirstDeletion);

      // The gesture on the SURVIVING second HR, still mounted, while that
      // transfer is held: no menu, no second request, no write.
      layoutContextMenuSurface(surviving);
      fireEvent.pointerDown(surviving, { button: 2, clientX: 20, clientY: 20 });
      fireEvent.contextMenu(surviving, { clientX: 20, clientY: 20 });
      await act(async () => {
        await Promise.resolve();
      });
      expect(vi.mocked(props.previewPort.render).mock.calls.length).toBe(
        requestsBefore + 1
      );
      expect(within(document.body).queryAllByRole('menu')).toHaveLength(0);
      expect(owner.getValue()).toBe(afterFirstDeletion);
      expect(owner.getHistoryState()).toEqual(firstDeletionHistory);

      held.resolve(responseFor(heldRequest));
      await waitFor(
        () =>
          expect(within(document.body).queryAllByRole('menu')).toHaveLength(1),
        { timeout: 5000 }
      );
      // Still exactly one request: the demand was served by the transfer it
      // joined, not by a new authentication.
      expect(vi.mocked(props.previewPort.render).mock.calls.length).toBe(
        requestsBefore + 1
      );
      // Disarm the held transfer: every later legitimate request (the survivor
      // removal, and each Undo/Redo refresh) must get a FRESH response for its
      // own request, never this obsolete held one.
      holdTransfer = false;
      // The fresh accepted map puts the SURVIVOR at b2; the gesture must act on
      // that HR rather than on a same-ID neighbour.
      const acceptedBreaks = visual.querySelectorAll('hr');
      expect(acceptedBreaks).toHaveLength(1);
      expect(acceptedBreaks[0]?.getAttribute('data-easymde-visual-block-id')).toBe(
        'b2'
      );
      fireEvent.click(
        within(within(document.body).getByRole('menu')).getByRole('menuitem', {
          name: 'Delete horizontal rule'
        })
      );
      // Deleting the surviving HR removes its own three dashes at their
      // CURRENT offsets [15,18), leaving the preserved separators and both
      // untouched paragraphs exactly.
      expect(afterFirstDeletion.slice(15, 18)).toBe('---');
      const afterSecondDeletion =
        afterFirstDeletion.slice(0, 15) + afterFirstDeletion.slice(18);
      await waitFor(() =>
        expect(props.submissionField.value).toBe(afterSecondDeletion)
      );
      expect(props.submissionField.value).toBe(
        'before\n\n\n\nmid\n\n\n\nafter'
      );
      // Exactly one more canonical history entry for this second removal.
      expect(owner.getHistoryState().undoDepth).toBe(
        firstDeletionHistory.undoDepth + 1
      );
      // The deletion's own ACCEPTED presentation must land before history is
      // exercised: no HR remains in the accepted DOM and the surface is ready
      // and editable. A canonical-only success would not satisfy this.
      await waitFor(() => expect(visual.querySelectorAll('hr')).toHaveLength(0));
      await waitFor(() =>
        expect(visual.getAttribute('data-easymde-preview-phase')).toBe('ready')
      );
      expect(visual.getAttribute('contenteditable')).toBe('true');
      expect(owner.getValue()).toBe(afterSecondDeletion);

      // Native history over the real document: Undo restores the survivor and
      // Redo removes it again.
      fireEvent.keyDown(visual, { cancelable: true, ctrlKey: true, key: 'z' });
      await waitFor(() => expect(owner.getValue()).toBe(afterFirstDeletion));
      await waitFor(() => expect(visual.querySelectorAll('hr')).toHaveLength(1));
      await waitFor(() =>
        expect(visual.getAttribute('data-easymde-preview-phase')).toBe('ready')
      );
      expect(visual.getAttribute('contenteditable')).toBe('true');
      fireEvent.keyDown(visual, {
        cancelable: true,
        ctrlKey: true,
        key: 'z',
        shiftKey: true
      });
      await waitFor(() => expect(owner.getValue()).toBe(afterSecondDeletion));
      await waitFor(() => expect(visual.querySelectorAll('hr')).toHaveLength(0));
      // The Redo's own accepted readiness/editability barrier.
      await waitFor(() =>
        expect(visual.getAttribute('data-easymde-preview-phase')).toBe('ready')
      );
      expect(visual.getAttribute('contenteditable')).toBe('true');
      expect(props.onFailure).not.toHaveBeenCalled();
      expect(owner.getRevision?.()).not.toBe(revisionBefore);
    } finally {
      props.submissionField.readOnly = false;
      view.unmount();
      sessionSpy.mockRestore();
    }
  });

  it('tears down an actively open keyboard demand when the user leaves the mode', async () => {
    // Leaving the mode while the menu is STILL OPEN is the real teardown path:
    // the demand is live, it owns a target witness, and nothing may act, reopen,
    // or write after the user has gone.
    const props = fixture();
    const initial = 'Lead\n\nTail';
    props.submissionField.value = initial;
    props.submissionField.defaultValue = initial;
    props.submissionField.setSelectionRange(0, 0);
    vi.mocked(props.previewPort.render).mockImplementation((request) =>
      Promise.resolve({
        editMap: {
          blocks: [
            { editable: true, endLine: 1, id: 'b0', startLine: 0 },
            { editable: true, endLine: 3, id: 'b1', startLine: 2 }
          ],
          coordinate: 'line' as const,
          signature: request.signature,
          version: 1 as const
        },
        features: {},
        html: (
          '<p data-easymde-visual-block-id="b0">Lead</p>'
          + '<p data-easymde-visual-block-id="b1">Tail</p>'
        ) as SafePreviewHtml
      })
    );
    // The canonical owner itself: teardown is proved against real history and
    // revision, not only against the submission field.
    const realCreateDocumentSession =
      observedSourceAdapter.createCodeMirrorDocumentSession;
    const documentOwnerRef: {
      current: ReturnType<typeof realCreateDocumentSession> | null;
    } = { current: null };
    vi.spyOn(observedSourceAdapter, 'createCodeMirrorDocumentSession')
      .mockImplementation((options) => {
        const owner = realCreateDocumentSession(options);
        documentOwnerRef.current = owner;
        return owner;
      });
    const view = render(<EditorRoot {...props} />);
    try {
      fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
      fireEvent.click(view.getByRole('button', { name: '预览' }));
      await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
      layoutPreviewSurface(view.container);
      fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
      const visual = await view.findByRole('textbox', { name: '可视化文章编辑器' });
      await waitFor(() =>
        expect(visual.getAttribute('data-easymde-preview-phase')).toBe('ready')
      );
      const owner = documentOwnerRef.current;
      if (!owner) throw new Error('active-teardown-owner-missing');
      const writesBeforeGesture = vi.mocked(
        props.editorClipboardPort?.write ?? (() => undefined)
      ).mock.calls.length;
      const historyBeforeGesture = owner.getHistoryState();
      const revisionBeforeGesture = owner.getRevision?.();
      const sourceBeforeGesture = owner.getValue();
      fireEvent.keyDown(visual, { key: 'F10', shiftKey: true });
      expect(await within(document.body).findByRole('menu')).toBeTruthy();
      expect(
        vi.mocked(props.editorClipboardPort?.write ?? (() => undefined)).mock
          .calls.length
      ).toBe(writesBeforeGesture);

      // Mode exit with the demand still live.
      fireEvent.click(view.getByRole('button', { name: '退出沉浸写作' }));
      await waitFor(() =>
        expect(view.queryByRole('textbox', { name: '可视化文章编辑器' })).toBeNull()
      );
      await waitFor(() =>
        expect(within(document.body).queryAllByRole('menu')).toHaveLength(0)
      );
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      // No late menu, no deferred action, no failure, no canonical or history
      // write from the torn-down gesture.
      expect(within(document.body).queryAllByRole('menu')).toHaveLength(0);
      expect(
        vi.mocked(props.editorClipboardPort?.write ?? (() => undefined)).mock
          .calls.length
      ).toBe(writesBeforeGesture);
      expect(props.onFailure).not.toHaveBeenCalled();
      expect(props.submissionField.value).toBe(initial);
      // Real owner state, not just the field: the torn-down gesture added no
      // history entry and advanced no revision.
      expect(owner.getValue()).toBe(sourceBeforeGesture);
      expect(owner.getHistoryState()).toEqual(historyBeforeGesture);
      expect(owner.getRevision?.()).toBe(revisionBeforeGesture);
    } finally {
      view.unmount();
    }
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

describe('FullPlan frozen Root lifecycle consumer', () => {
  it.each(['native-edit', 'IME', 'Paste'] as const)('preserves a real Full %s across Root props-only rerender', async (operation) => {
    const props = fixture();
    const initial = 'prefix target suffix';
    const offset = 8;
    const insert = 'IME' === operation ? '文字' : 'X';
    const expected = initial.slice(0, offset) + insert + initial.slice(offset);
    props.submissionField.value = initial;
    props.submissionField.defaultValue = initial;
    props.submissionField.setSelectionRange(0, 0);
    const originalCreate = observedSourceAdapter.createCodeMirrorDocumentSession;
    const ownerRef: { current: CodeMirrorDocumentSession | null } = { current: null };
    vi.spyOn(observedSourceAdapter, 'createCodeMirrorDocumentSession').mockImplementation((options) => {
      const owner = originalCreate(options);
      ownerRef.current = owner;
      return owner;
    });
    const held = deferred<PreviewResponse>();
    let heldRequest: PreviewRequest | null = null;
    let holdPaste = false;
    const response = (request: PreviewRequest): PreviewResponse => createPreviewResponse(request, `<p>${request.markdown}</p>` as SafePreviewHtml, {});
    vi.mocked(props.previewPort.render).mockImplementation((request) => {
      if (holdPaste && request.markdown === expected) {
        heldRequest = request;
        return held.promise;
      }
      return Promise.resolve(response(request));
    });
    const view = render(<EditorRoot {...props} />);
    try {
      fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
      fireEvent.click(view.getByRole('button', { name: '预览' }));
      await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
      fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
      const surface = await view.findByRole('textbox', { name: '可视化文章编辑器' });
      const owner = ownerRef.current;
      if (!owner) throw new Error('full-plan-root-real-owner-missing');
      expect(owner.getValue()).toBe(initial);
      expect(owner.getSelection()).toEqual({ direction: 'none', end: 0, start: 0 });
      const revision = owner.getRevision?.();
      expect(typeof revision).toBe('number');
      const text = surface.querySelector('p')?.firstChild;
      if (!(text instanceof Text)) throw new Error('full-plan-root-native-text-missing');
      surface.focus();
      window.getSelection()?.collapse(text, offset);
      if ('Paste' === operation) {
        holdPaste = true;
        fireEvent.paste(surface, { clipboardData: { files: [], getData: (type: string) => 'text/plain' === type ? insert : '', types: ['text/plain'] } });
        await waitFor(() => expect(heldRequest).not.toBeNull());
        expect(surface.getAttribute('data-easymde-preview-phase')).not.toBe('ready');
      } else {
        if ('IME' === operation) fireEvent.compositionStart(surface);
        const inputType = 'IME' === operation ? 'insertCompositionText' : 'insertText';
        const before = new InputEvent('beforeinput', { bubbles: true, cancelable: true, data: insert, inputType, isComposing: 'IME' === operation });
        surface.dispatchEvent(before);
        expect(before.defaultPrevented).toBe(false);
        text.insertData(offset, insert);
        window.getSelection()?.collapse(text, offset + insert.length);
        surface.dispatchEvent(new InputEvent('input', { bubbles: true, data: insert, inputType, isComposing: 'IME' === operation }));
      }
      // A normal parent callback update must not dispose the visual owner or
      // erase its pending input, composition, or awaited formal transfer.
      view.rerender(<EditorRoot {...props} onFailure={(code) => props.onFailure(code)} />);
      expect(ownerRef.current).toBe(owner);
      expect(surface.isConnected).toBe(true);
      expect(text.isConnected).toBe(true);
      if ('IME' === operation) {
        expect(owner.getValue()).toBe(initial);
        fireEvent.compositionEnd(surface, { data: insert });
      }
      await waitFor(() => expect(owner.getValue()).toBe(expected));
      expect(owner.getRevision?.()).toBe((revision as number) + 1);
      expect(owner.getHistoryState()).toEqual({ redoDepth: 0, undoDepth: 1 });
      if ('Paste' === operation) {
        const request = heldRequest;
        if (!request) throw new Error('full-plan-root-held-response-missing');
        holdPaste = false;
        await act(async () => held.resolve(response(request)));
      }
      await waitFor(() => {
        expect(surface.getAttribute('data-easymde-preview-phase')).toBe('ready');
        expect(surface.textContent).toBe(expected);
      });
      expect(props.submissionField.value).toBe(expected);
      expect(owner.getSelection()).toEqual({ direction: 'none', end: offset + insert.length, start: offset + insert.length });
      const acceptedText = surface.querySelector('p')?.firstChild;
      expect(window.getSelection()?.anchorNode).toBe(acceptedText);
      expect(window.getSelection()?.anchorOffset).toBe(offset + insert.length);
      expect(window.getSelection()?.isCollapsed).toBe(true);
      expect(surface.getAttribute('contenteditable')).toBe('true');
      expect(props.onFailure).not.toHaveBeenCalled();
    } finally {
      view.unmount();
    }
  });

  it.each(['```', '~~~ruby', '```ruby', 'plain'])('restores a Full literal paragraph insertion point for %s after locking, formal acceptance and unlocking', async (input) => {
    const props = fixture();
    const initial = '# Heading\n\nTarget paragraph.\n\n```\nkept\n```\n';
    const typed = initial.replace('Target', `${input.replace(/[~`]/g, character => `\\${character}`)}Target`);
    const insertion = typed.indexOf('Target');
    props.submissionField.value = initial;
    props.submissionField.defaultValue = initial;
    props.submissionField.setSelectionRange(initial.indexOf('Target'), initial.indexOf('Target'));
    const originalCreate = observedSourceAdapter.createCodeMirrorDocumentSession;
    const ownerRef: { current: CodeMirrorDocumentSession | null } = { current: null };
    vi.spyOn(observedSourceAdapter, 'createCodeMirrorDocumentSession').mockImplementation((options) => {
      const owner = originalCreate(options);
      ownerRef.current = owner;
      return owner;
    });
    const held = deferred<PreviewResponse>();
    let holdRefresh = false;
    const heldRequest: { current: PreviewRequest | null } = { current: null };
    const response = (request: PreviewRequest): PreviewResponse => ({
      ...createPreviewResponse(request, `<h1>Heading</h1><p>${request.markdown === initial ? '' : input}Target paragraph.</p><pre><code>kept\n</code></pre>` as SafePreviewHtml, {}),
      editMap: {
        version: 1,
        coordinate: 'line',
        signature: request.signature,
        blocks: [
          { id: 'b0', startLine: 0, endLine: 2, editable: true },
          { id: 'b1', startLine: 2, endLine: 4, editable: true },
          { id: 'b2', startLine: 4, endLine: 8, editable: true }
        ]
      }
    });
    vi.mocked(props.previewPort.render).mockImplementation((request) => {
      if (holdRefresh) {
        heldRequest.current = request;
        return held.promise;
      }
      return Promise.resolve(response(request));
    });
    const view = render(<EditorRoot {...props} />);
    try {
      fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
      fireEvent.click(view.getByRole('button', { name: '预览' }));
      await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
      layoutPreviewSurface(view.container);
      fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
      const surface = await view.findByRole('textbox', { name: '可视化文章编辑器' });
      const owner = ownerRef.current;
      if (!owner) throw new Error('full-lock-canonical-owner-missing');
      surface.focus();
      window.getSelection()?.collapse(surface.querySelector('p')?.firstChild ?? surface, 0);
      for (let count = 0; count < input.length; count += 1) {
        act(() => {
          const native = window.getSelection();
          const text = native?.anchorNode;
          if (!(text instanceof Text)) throw new Error('full-lock-native-text-missing');
          const offset = native?.anchorOffset ?? 0;
          const character = input.charAt(count);
          const key = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: character });
          surface.dispatchEvent(key);
          if (key.defaultPrevented) return;
          const before = new InputEvent('beforeinput', { bubbles: true, cancelable: true, data: character, inputType: 'insertText' });
          surface.dispatchEvent(before);
          if (before.defaultPrevented) return;
          text.insertData(offset, character);
          native?.collapse(text, offset + 1);
          surface.dispatchEvent(new InputEvent('input', { bubbles: true, data: character, inputType: 'insertText' }));
        });
        await waitFor(() => expect(owner.getValue().replace(/\\([~`])/g, '$1')).toContain(`${input.slice(0, count + 1)}Target`));
      }
      await waitFor(() => expect(owner.getValue()).toBe(typed));
      holdRefresh = true;
      const lock = view.getByRole('button', { name: '锁定为只读' });
      lock.focus();
      fireEvent.click(lock);
      await waitFor(() => expect(heldRequest.current).not.toBeNull());
      const request = heldRequest.current;
      if (!request) throw new Error('full-lock-formal-request-missing');
      expect(request.markdown).toBe(typed);
      holdRefresh = false;
      await act(async () => held.resolve(response(request)));
      const unlock = await view.findByRole('button', { name: '解除锁定并编辑' });
      await waitFor(() => expect(unlock.hasAttribute('disabled')).toBe(false));
      layoutPreviewSurface(view.container);
      fireEvent.click(unlock);
      const accepted = await view.findByRole('textbox', { name: '可视化文章编辑器' });
      await waitFor(() => expect(accepted.getAttribute('data-easymde-preview-phase')).toBe('ready'));
      expect(owner.getValue()).toBe(typed);
      expect(accepted.querySelector('pre code')?.textContent).toBe('kept\n');
      const native = window.getSelection();
      const anchor = native?.anchorNode;
      expect(anchor?.parentElement?.closest('p')?.textContent).toBe(`${input}Target paragraph.`);
      expect(native?.anchorOffset).toBe(input.length);
      expect(owner.getSelection()).toEqual({ direction: 'none', start: insertion, end: insertion });
      if (!(anchor instanceof Text)) throw new Error('full-lock-accepted-text-caret-missing');
      act(() => {
        const before = new InputEvent('beforeinput', { bubbles: true, cancelable: true, data: 'z', inputType: 'insertText' });
        accepted.dispatchEvent(before);
        if (before.defaultPrevented) return;
        anchor.insertData(native?.anchorOffset ?? 0, 'z');
        native?.collapse(anchor, input.length + 1);
        accepted.dispatchEvent(new InputEvent('input', { bubbles: true, data: 'z', inputType: 'insertText' }));
      });
      await waitFor(() => expect(owner.getValue()).toBe(typed.slice(0, insertion) + 'z' + typed.slice(insertion)));
      act(() => {
        const key = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Backspace' });
        accepted.dispatchEvent(key);
        if (key.defaultPrevented) return;
        const selection = window.getSelection();
        const text = selection?.anchorNode;
        const offset = selection?.anchorOffset ?? 0;
        if (!(text instanceof Text) || offset < 1) throw new Error('full-lock-delete-caret-missing');
        const range = document.createRange();
        range.setStart(text, offset - 1);
        range.setEnd(text, offset);
        const before = new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'deleteContentBackward' });
        Object.defineProperty(before, 'getTargetRanges', { value: () => [range] });
        accepted.dispatchEvent(before);
        if (before.defaultPrevented) return;
        text.deleteData(offset - 1, 1);
        selection?.collapse(text, offset - 1);
        accepted.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
      });
      await waitFor(() => expect(owner.getValue()).toBe(typed));
      expect(window.getSelection()?.anchorOffset).toBe(input.length);
      expect(owner.getSelection()).toEqual({ direction: 'none', start: insertion, end: insertion });
      expect(accepted.querySelector('pre code')?.textContent).toBe('kept\n');
      expect(accepted.querySelector('h1')?.textContent).toBe('Heading');
      expect(props.onFailure).not.toHaveBeenCalled();
    } finally {
      holdRefresh = false;
      if (heldRequest.current) held.resolve(response(heldRequest.current));
      view.unmount();
    }
  });
  it.each(['~', '`'])('enters Source with one click after a rapid %s pair before an existing pair without another document edit', async (marker) => {
    const props = fixture();
    const pair = marker.repeat(2);
    const initial = `# Heading\n\n${pair}Target paragraph here.\n\n\x60\x60\x60\nalpha\nbeta\n\x60\x60\x60\n\n\x60\x60\x60ruby\nputs :kept\n\x60\x60\x60\n\n### Heading after\n\nFinal paragraph.`;
    const escapedRun = marker.repeat(4).replace(/[~`]/g, character => `\\${character}`);
    const expected = initial.replace(`${pair}Target`, `${escapedRun}Target`);
    const insertion = initial.indexOf(pair);
    props.submissionField.value = initial;
    props.submissionField.defaultValue = initial;
    props.submissionField.setSelectionRange(insertion, insertion);
    const originalCreate = observedSourceAdapter.createCodeMirrorDocumentSession;
    const ownerRef: { current: CodeMirrorDocumentSession | null } = { current: null };
    vi.spyOn(observedSourceAdapter, 'createCodeMirrorDocumentSession').mockImplementation((options) => {
      const owner = originalCreate(options);
      ownerRef.current = owner;
      return owner;
    });
    vi.mocked(props.previewPort.render).mockImplementation(async (request) => ({
      ...createPreviewResponse(request, `<h1>Heading</h1><p>${request.markdown === initial ? pair : marker.repeat(4)}Target paragraph here.</p><pre><code>alpha\nbeta\n</code></pre><pre><code class="language-ruby">puts :kept\n</code></pre><h3>Heading after</h3><p>Final paragraph.</p>` as SafePreviewHtml, {}),
      editMap: {
        version: 1,
        coordinate: 'line',
        signature: request.signature,
        blocks: [
          { id: 'b0', startLine: 0, endLine: 2, editable: true },
          { id: 'b1', startLine: 2, endLine: 4, editable: true },
          { id: 'b2', startLine: 4, endLine: 9, editable: true },
          { id: 'b3', startLine: 9, endLine: 13, editable: true },
          { id: 'b4', startLine: 13, endLine: 15, editable: true },
          { id: 'b5', startLine: 15, endLine: 16, editable: true }
        ]
      }
    }));
    const view = render(<EditorRoot {...props} />);
    try {
      fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
      fireEvent.click(view.getByRole('button', { name: '预览' }));
      await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
      layoutPreviewSurface(view.container);
      fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
      const surface = await view.findByRole('textbox', { name: '可视化文章编辑器' });
      const owner = ownerRef.current;
      if (!owner) throw new Error('rapid-source-canonical-owner-missing');
      const text = surface.querySelector('p')?.firstChild;
      if (!(text instanceof Text)) throw new Error('rapid-source-native-text-missing');
      surface.focus();
      window.getSelection()?.collapse(text, 0);
      const initialRevision = owner.getRevision();
      const initialHistory = owner.getHistoryState();
      // Both native inputs precede the deferred serializer, as in the rapid consumer.
      act(() => {
        for (const character of pair) {
          const key = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: character });
          surface.dispatchEvent(key);
          if (key.defaultPrevented) continue;
          const before = new InputEvent('beforeinput', { bubbles: true, cancelable: true, data: character, inputType: 'insertText' });
          surface.dispatchEvent(before);
          if (before.defaultPrevented) continue;
          const native = window.getSelection();
          if (!(native?.anchorNode instanceof Text)) throw new Error('rapid-source-input-caret-missing');
          const node = native.anchorNode;
          const offset = native.anchorOffset;
          node.insertData(offset, character);
          native.collapse(node, offset + 1);
          surface.dispatchEvent(new InputEvent('input', { bubbles: true, data: character, inputType: 'insertText' }));
        }
      });
      await waitFor(() => expect(owner.getValue()).toBe(expected));
      const selection = { direction: 'none', start: insertion + 4, end: insertion + 4 };
      expect(owner.getSelection()).toEqual(selection);
      const native = window.getSelection();
      const paragraph = surface.querySelector('p');
      if (!paragraph || !native?.anchorNode) throw new Error('rapid-source-settled-caret-missing');
      const prefix = document.createRange();
      prefix.selectNodeContents(paragraph);
      prefix.setEnd(native.anchorNode, native.anchorOffset);
      expect(prefix.toString()).toBe(pair);
      expect(paragraph.textContent).toBe(`${marker.repeat(4)}Target paragraph here.`);
      expect(Array.from(surface.querySelectorAll('pre code'), node => node.textContent)).toEqual(['alpha\nbeta\n', 'puts :kept\n']);
      expect(surface.querySelector('h3')?.textContent).toBe('Heading after');
      const revision = owner.getRevision();
      const history = owner.getHistoryState();
      expect(revision).toBe(initialRevision + 1);
      expect(history).toEqual({ redoDepth: 0, undoDepth: initialHistory.undoDepth + 1 });
      expect(props.onFailure).not.toHaveBeenCalled();

      // Source preparation must serialize the already committed DOM without an extra edit or retry.
      fireEvent.click(view.getByRole('button', { name: '编辑模式' }));
      await waitFor(() => expect(view.container.querySelector('.easymde-editor')?.classList.contains('is-immersive-source')).toBe(true));
      expect(view.container.querySelector('.easymde-source-react .cm-content')).not.toBeNull();
      expect(owner.getValue()).toBe(expected);
      expect(props.submissionField.value).toBe(expected);
      expect(owner.getSelection()).toEqual(selection);
      expect(owner.getRevision()).toBe(revision);
      expect(owner.getHistoryState()).toEqual(history);
      expect(props.onFailure).not.toHaveBeenCalled();
      act(() => { expect(owner.undo()).toBe(true); });
      expect(owner.getValue()).toBe(initial);
      expect(owner.getHistoryState()).toEqual({ redoDepth: 1, undoDepth: initialHistory.undoDepth });
      act(() => { expect(owner.redo()).toBe(true); });
      expect(owner.getValue()).toBe(expected);
      expect(owner.getHistoryState()).toEqual(history);
      expect(props.onFailure).not.toHaveBeenCalled();
    } finally {
      view.unmount();
    }
  });


  it.each([{ marker: '~', scenario: 'astral row' }, { marker: '`', scenario: 'astral row' }, { marker: '~', scenario: 'backward Text range' }, { marker: '`', scenario: 'backward Text range' }] as const)('preserves decoded literal $scenario through one Source click ($marker)', async ({ marker, scenario }) => {
    const props = fixture();
    const pair = marker.repeat(2);
    const astral = scenario === 'astral row' ? ' 🌱' : '';
    const initial = `# Heading\n\n${pair}Target paragraph here.${astral}\n\n\x60\x60\x60\nalpha\nbeta\n\x60\x60\x60\n\n\x60\x60\x60ruby\nputs :kept\n\x60\x60\x60\n\n### Heading after\n\nFinal paragraph.`;
    const escapedRun = marker.repeat(4).replace(/[~`]/g, character => `\\${character}`);
    const expected = initial.replace(`${pair}Target`, `${escapedRun}Target`);
    const insertion = initial.indexOf(pair);
    props.submissionField.value = initial;
    props.submissionField.defaultValue = initial;
    props.submissionField.setSelectionRange(insertion, insertion);
    const originalCreate = observedSourceAdapter.createCodeMirrorDocumentSession;
    const ownerRef: { current: CodeMirrorDocumentSession | null } = { current: null };
    vi.spyOn(observedSourceAdapter, 'createCodeMirrorDocumentSession').mockImplementation((options) => {
      const owner = originalCreate(options);
      ownerRef.current = owner;
      return owner;
    });
    vi.mocked(props.previewPort.render).mockImplementation(async (request) => ({
      ...createPreviewResponse(request, `<h1>Heading</h1><p>${request.markdown === initial ? pair : marker.repeat(4)}Target paragraph here.${astral}</p><pre><code>alpha\nbeta\n</code></pre><pre><code class="language-ruby">puts :kept\n</code></pre><h3>Heading after</h3><p>Final paragraph.</p>` as SafePreviewHtml, {}),
      editMap: {
        version: 1,
        coordinate: 'line',
        signature: request.signature,
        blocks: [
          { id: 'b0', startLine: 0, endLine: 2, editable: true },
          { id: 'b1', startLine: 2, endLine: 4, editable: true },
          { id: 'b2', startLine: 4, endLine: 9, editable: true },
          { id: 'b3', startLine: 9, endLine: 13, editable: true },
          { id: 'b4', startLine: 13, endLine: 15, editable: true },
          { id: 'b5', startLine: 15, endLine: 16, editable: true }
        ]
      }
    }));
    const view = render(<EditorRoot {...props} />);
    try {
      fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
      fireEvent.click(view.getByRole('button', { name: '预览' }));
      await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
      layoutPreviewSurface(view.container);
      fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
      const surface = await view.findByRole('textbox', { name: '可视化文章编辑器' });
      const owner = ownerRef.current;
      if (!owner) throw new Error('rapid-source-canonical-owner-missing');
      const text = surface.querySelector('p')?.firstChild;
      if (!(text instanceof Text)) throw new Error('rapid-source-native-text-missing');
      surface.focus();
      window.getSelection()?.collapse(text, 0);
      const initialRevision = owner.getRevision();
      const initialHistory = owner.getHistoryState();
      // Both native inputs precede the deferred serializer, as in the rapid consumer.
      act(() => {
        for (const character of pair) {
          const key = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: character });
          surface.dispatchEvent(key);
          if (key.defaultPrevented) continue;
          const before = new InputEvent('beforeinput', { bubbles: true, cancelable: true, data: character, inputType: 'insertText' });
          surface.dispatchEvent(before);
          if (before.defaultPrevented) continue;
          const native = window.getSelection();
          if (!(native?.anchorNode instanceof Text)) throw new Error('rapid-source-input-caret-missing');
          const node = native.anchorNode;
          const offset = native.anchorOffset;
          node.insertData(offset, character);
          native.collapse(node, offset + 1);
          surface.dispatchEvent(new InputEvent('input', { bubbles: true, data: character, inputType: 'insertText' }));
        }
      });
      await waitFor(() => expect(owner.getValue()).toBe(expected));
      let selection: DocumentSelection = { direction: 'none', start: insertion + 4, end: insertion + 4 };
      expect(owner.getSelection()).toEqual(selection);
      const native = window.getSelection();
      const paragraph = surface.querySelector('p');
      if (!paragraph || !native?.anchorNode) throw new Error('rapid-source-settled-caret-missing');
      const prefix = document.createRange();
      prefix.selectNodeContents(paragraph);
      prefix.setEnd(native.anchorNode, native.anchorOffset);
      expect(prefix.toString()).toBe(pair);
      expect(paragraph.textContent).toBe(`${marker.repeat(4)}Target paragraph here.${astral}`);
      expect(Array.from(surface.querySelectorAll('pre code'), node => node.textContent)).toEqual(['alpha\nbeta\n', 'puts :kept\n']);
      expect(surface.querySelector('h3')?.textContent).toBe('Heading after');
      const revision = owner.getRevision();
      const history = owner.getHistoryState();
      expect(revision).toBe(initialRevision + 1);
      expect(history).toEqual({ redoDepth: 0, undoDepth: initialHistory.undoDepth + 1 });
      expect(props.onFailure).not.toHaveBeenCalled();

      if (scenario === 'backward Text range') {
        const left = paragraph.firstChild;
        if (!(left instanceof Text)) throw new Error('decoded-backward-text-missing');
        const right = left.splitText(2);
        const down = new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 });
        paragraph.dispatchEvent(down);
        expect(down.defaultPrevented).toBe(false);
        // Apply the native drag's backward range across adjacent Text nodes.
        window.getSelection()?.setBaseAndExtent(right, 4, left, 1);
        paragraph.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0 }));
        document.dispatchEvent(new Event('selectionchange'));
        const dragged = window.getSelection();
        expect(dragged?.anchorNode).toBe(right);
        expect(dragged?.anchorOffset).toBe(4);
        expect(dragged?.focusNode).toBe(left);
        expect(dragged?.focusOffset).toBe(1);
        expect(dragged?.isCollapsed).toBe(false);
        selection = { direction: 'backward', start: insertion + 2, end: expected.indexOf('Target') + 2 };
        expect(owner.getRevision()).toBe(revision);
        expect(owner.getHistoryState()).toEqual(history);
      }

      // Source preparation must serialize the already committed DOM without an extra edit or retry.
      fireEvent.click(view.getByRole('button', { name: '编辑模式' }));
      await waitFor(() => expect(view.container.querySelector('.easymde-editor')?.classList.contains('is-immersive-source')).toBe(true));
      expect(view.container.querySelector('.easymde-source-react .cm-content')).not.toBeNull();
      expect(owner.getValue()).toBe(expected);
      expect(props.submissionField.value).toBe(expected);
      expect(owner.getSelection()).toEqual(selection);
      expect(owner.getRevision()).toBe(revision);
      expect(owner.getHistoryState()).toEqual(history);
      expect(props.onFailure).not.toHaveBeenCalled();
      act(() => { expect(owner.undo()).toBe(true); });
      expect(owner.getValue()).toBe(initial);
      expect(owner.getHistoryState()).toEqual({ redoDepth: 1, undoDepth: initialHistory.undoDepth });
      act(() => { expect(owner.redo()).toBe(true); });
      expect(owner.getValue()).toBe(expected);
      expect(owner.getHistoryState()).toEqual(history);
      expect(props.onFailure).not.toHaveBeenCalled();
    } finally {
      view.unmount();
    }
  });
});

describe('whole-unit frozen consumer wave', () => {
  const slash = String.fromCharCode(92);
  const documentFor = (row: string): string => `# Synthetic Full fixture\n\n${row}\n\n\x60\x60\x60\nalpha\nbeta\n\x60\x60\x60\n\n\x60\x60\x60ruby\nputs :kept\n\x60\x60\x60\n\n### Heading after\n\nFinal paragraph.`;
  const responseFor = (request: PreviewRequest, row: string, terminal = 'Final paragraph.'): PreviewResponse => ({
    ...createPreviewResponse(request, `<h1>Synthetic Full fixture</h1><p>${row}</p><pre><code>alpha\nbeta\n</code></pre><pre><code class="language-ruby">puts :kept\n</code></pre><h3>Heading after</h3><p>${terminal}</p>` as SafePreviewHtml, {}),
    editMap: {
      version: 1, coordinate: 'line', signature: request.signature,
      blocks: [
        { id: 'b0', startLine: 0, endLine: 2, editable: true },
        { id: 'b1', startLine: 2, endLine: 4, editable: true },
        { id: 'b2', startLine: 4, endLine: 9, editable: true },
        { id: 'b3', startLine: 9, endLine: 13, editable: true },
        { id: 'b4', startLine: 13, endLine: 15, editable: true },
        { id: 'b5', startLine: 15, endLine: 16, editable: true }
      ]
    }
  });
  const insertAtNativeCaret = (surface: HTMLElement, data: string): void => {
    const key = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: data });
    surface.dispatchEvent(key);
    if (key.defaultPrevented) return;
    const native = window.getSelection();
    if (!(native?.anchorNode instanceof Text) || !native.isCollapsed) throw new Error('whole-unit-root-native-caret-missing');
    const text = native.anchorNode;
    const offset = native.anchorOffset;
    const range = document.createRange();
    range.setStart(text, offset); range.collapse(true);
    const before = new InputEvent('beforeinput', { bubbles: true, cancelable: true, data, inputType: 'insertText' });
    Object.defineProperty(before, 'getTargetRanges', { value: () => [range] });
    surface.dispatchEvent(before);
    if (before.defaultPrevented) return;
    text.insertData(offset, data);
    native.collapse(text, offset + data.length);
    surface.dispatchEvent(new InputEvent('input', { bubbles: true, data, inputType: 'insertText' }));
  };

  it.for(['~', '`'] as const)('preserves a whole-unit caret through one Source and Preview round trip (%s)', async (marker, { task }) => {
    const props = fixture();
    const sourcePrefix = `${(slash + marker).repeat(4)}Path `;
    const visiblePrefix = `${marker.repeat(4)}Path `;
    const sourceRow = `${sourcePrefix}${slash.repeat(2)}${marker} tail`;
    const visibleRow = `${visiblePrefix}${slash}${marker} tail`;
    const initial = documentFor(sourceRow);
    const nativePoint = visiblePrefix.length + 1;
    const point = initial.indexOf(sourceRow) + sourcePrefix.length + 2;
    const expected = initial.slice(0, point) + 'x' + initial.slice(point);
    props.submissionField.value = initial;
    props.submissionField.defaultValue = initial;
    props.submissionField.setSelectionRange(0, 0);
    const create = observedSourceAdapter.createCodeMirrorDocumentSession;
    const ownerRef: { current: CodeMirrorDocumentSession | null } = { current: null };
    vi.spyOn(observedSourceAdapter, 'createCodeMirrorDocumentSession').mockImplementation(options => {
      const owner = create(options); ownerRef.current = owner; return owner;
    });
    vi.mocked(props.previewPort.render).mockImplementation(async request => {
      if (request.markdown === initial) return responseFor(request, visibleRow);
      if (request.markdown === expected) return responseFor(request, visibleRow.slice(0, nativePoint) + 'x' + visibleRow.slice(nativePoint));
      throw new Error('whole-unit-root-unexpected-formal-source');
    });
    const metadata = { phase: 'setup', point, nativePoint, actual: null as unknown };
    Object.assign(task.meta, { wholeUnit: metadata });
    const view = render(<EditorRoot {...props} />);
    try {
      fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
      fireEvent.click(view.getByRole('button', { name: '预览' }));
      await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
      layoutPreviewSurface(view.container);
      fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
      const surface = await view.findByRole('textbox', { name: '可视化文章编辑器' });
      const owner = ownerRef.current;
      const paragraph = surface.querySelector('[data-easymde-visual-block-id="b1"]');
      const text = paragraph?.firstChild;
      if (!owner || !(text instanceof Text)) throw new Error('whole-unit-root-owner-or-row-missing');
      const revision = owner.getRevision();
      const history = owner.getHistoryState();
      surface.focus();
      const down = new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 });
      paragraph?.dispatchEvent(down);
      expect(down.defaultPrevented).toBe(false);
      window.getSelection()?.collapse(text, nativePoint);
      paragraph?.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0 }));
      document.dispatchEvent(new Event('selectionchange'));
      expect(text.data).toBe(visibleRow);
      expect(window.getSelection()?.anchorOffset).toBe(nativePoint);
      expect(owner.getValue()).toBe(initial);
      metadata.phase = 'one-source-click';
      fireEvent.click(view.getByRole('button', { name: '编辑模式' }));
      await waitFor(() => expect(view.container.querySelector('.easymde-editor')?.classList.contains('is-immersive-source')).toBe(true));
      metadata.actual = { value: owner.getValue(), selection: owner.getSelection(), revision: owner.getRevision(), history: owner.getHistoryState(), failures: vi.mocked(props.onFailure).mock.calls };
      expect(owner.getValue()).toBe(initial);
      expect(props.submissionField.value).toBe(initial);
      expect(owner.getSelection(), 'Source must retain the legal point after both canonical backslashes').toEqual({ direction: 'none', start: point, end: point });
      expect(owner.getRevision()).toBe(revision);
      expect(owner.getHistoryState()).toEqual(history);
      expect(props.onFailure).not.toHaveBeenCalled();
      metadata.phase = 'preview-round-trip';
      fireEvent.click(view.getByRole('button', { name: '预览模式' }));
      const unlock = view.queryByRole('button', { name: '解除锁定并编辑' });
      if (unlock) {
        await waitFor(() => expect(unlock.hasAttribute('disabled')).toBe(false));
        layoutPreviewSurface(view.container);
        fireEvent.click(unlock);
      }
      const restored = await view.findByRole('textbox', { name: '可视化文章编辑器' });
      const restoredText = restored.querySelector('[data-easymde-visual-block-id="b1"]')?.firstChild;
      expect(window.getSelection()?.anchorNode).toBe(restoredText);
      expect(window.getSelection()?.anchorOffset).toBe(nativePoint);
      expect(owner.getRevision()).toBe(revision);
      expect(owner.getHistoryState()).toEqual(history);
      metadata.phase = 'round-trip-followup-input';
      act(() => insertAtNativeCaret(restored, 'x'));
      await waitFor(() => expect(owner.getRevision()).toBe(revision + 1));
      expect(owner.getValue()).toBe(expected);
      expect(owner.getSelection()).toEqual({ direction: 'none', start: point + 1, end: point + 1 });
      expect(owner.getHistoryState()).toEqual({ redoDepth: 0, undoDepth: history.undoDepth + 1 });
      expect(Array.from(restored.querySelectorAll('pre code'), node => node.textContent)).toEqual(['alpha\nbeta\n', 'puts :kept\n']);
      expect(restored.querySelector('h3')?.textContent).toBe('Heading after');
      expect(restored.lastElementChild?.textContent).toBe('Final paragraph.');
      metadata.phase = 'source-undo-redo';
      fireEvent.click(view.getByRole('button', { name: '编辑模式' }));
      await waitFor(() => expect(view.container.querySelector('.easymde-editor')?.classList.contains('is-immersive-source')).toBe(true));
      const committedRevision = owner.getRevision();
      expect(committedRevision).toBe(revision + 1);
      act(() => { expect(owner.undo()).toBe(true); });
      expect(owner.getValue()).toBe(initial);
      expect(owner.getHistoryState()).toEqual({ redoDepth: 1, undoDepth: history.undoDepth });
      act(() => { expect(owner.redo()).toBe(true); });
      expect(owner.getValue()).toBe(expected);
      expect(owner.getHistoryState()).toEqual({ redoDepth: 0, undoDepth: history.undoDepth + 1 });
      expect(props.onFailure).not.toHaveBeenCalled();
      metadata.phase = 'complete';
    } finally { view.unmount(); }
  });

  it.for(['~', '`'] as const)('sends a rapid terminal opener as a literal paragraph to the formal Preview owner (%s)', async (marker, { task }) => {
    const props = fixture();
    const initial = documentFor('Target paragraph here.');
    const run = marker.repeat(3);
    const escapedRun = (slash + marker).repeat(3);
    const point = initial.indexOf('Final paragraph.');
    const expected = initial.slice(0, point) + escapedRun + initial.slice(point);
    const continued = expected.slice(0, point + escapedRun.length) + 'x' + expected.slice(point + escapedRun.length);
    props.submissionField.value = initial;
    props.submissionField.defaultValue = initial;
    const create = observedSourceAdapter.createCodeMirrorDocumentSession;
    const ownerRef: { current: CodeMirrorDocumentSession | null } = { current: null };
    vi.spyOn(observedSourceAdapter, 'createCodeMirrorDocumentSession').mockImplementation(options => {
      const owner = create(options); ownerRef.current = owner; return owner;
    });
    vi.mocked(props.previewPort.render).mockImplementation(async request => {
      if (request.markdown === initial) return responseFor(request, 'Target paragraph here.');
      if (request.markdown === expected) return responseFor(request, 'Target paragraph here.', `${run}Final paragraph.`);
      if (request.markdown === continued) return responseFor(request, 'Target paragraph here.', `${run}xFinal paragraph.`);
      throw new Error('terminal-opener-unexpected-formal-source');
    });
    const metadata = { phase: 'setup', expected, actual: null as unknown, formalRequestReached: false };
    Object.assign(task.meta, { wholeUnit: metadata });
    const view = render(<EditorRoot {...props} />);
    try {
      fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
      fireEvent.click(view.getByRole('button', { name: '预览' }));
      await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
      layoutPreviewSurface(view.container);
      fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
      const surface = await view.findByRole('textbox', { name: '可视化文章编辑器' });
      const owner = ownerRef.current;
      const paragraph = surface.querySelector('[data-easymde-visual-block-id="b5"]');
      const text = paragraph?.firstChild;
      if (!owner || !(text instanceof Text)) throw new Error('terminal-root-owner-or-native-text-missing');
      surface.focus(); window.getSelection()?.collapse(text, 0);
      const revision = owner.getRevision();
      const history = owner.getHistoryState();
      metadata.phase = 'rapid-terminal-input-no-enter';
      act(() => { for (const character of run) insertAtNativeCaret(surface, character); });
      await waitFor(() => expect(owner.getRevision()).toBe(revision + 1));
      metadata.actual = { value: owner.getValue(), selection: owner.getSelection(), revision: owner.getRevision(), history: owner.getHistoryState(), kinds: observedBlockIndex(owner.getValue()).blocks.map(block => block.kind), nativeOffset: window.getSelection()?.anchorOffset, failures: vi.mocked(props.onFailure).mock.calls };
      expect(owner.getValue(), 'the formal request source must retain the terminal paragraph as escaped literal text').toBe(expected);
      expect(observedBlockIndex(owner.getValue()).blocks.map(block => block.kind)).toEqual(['heading', 'paragraph', 'code', 'code', 'heading', 'paragraph']);
      expect(owner.getSelection()).toEqual({ direction: 'none', start: point + escapedRun.length, end: point + escapedRun.length });
      expect(owner.getHistoryState()).toEqual({ redoDepth: 0, undoDepth: history.undoDepth + 1 });
      expect(window.getSelection()?.anchorNode).toBe(text);
      expect(window.getSelection()?.anchorOffset).toBe(run.length);
      metadata.phase = 'lock-formal-refresh';
      const requestCount = vi.mocked(props.previewPort.render).mock.calls.length;
      fireEvent.click(view.getByRole('button', { name: '锁定为只读' }));
      await waitFor(() => expect(vi.mocked(props.previewPort.render).mock.calls.length).toBeGreaterThan(requestCount));
      const request = vi.mocked(props.previewPort.render).mock.calls.at(-1)?.[0];
      expect(request?.markdown).toBe(expected);
      metadata.formalRequestReached = true;
      const unlock = await view.findByRole('button', { name: '解除锁定并编辑' });
      await waitFor(() => expect(unlock.hasAttribute('disabled')).toBe(false));
      layoutPreviewSurface(view.container);
      fireEvent.click(unlock);
      const restored = await view.findByRole('textbox', { name: '可视化文章编辑器' });
      await waitFor(() => expect(restored.getAttribute('data-easymde-preview-phase')).toBe('ready'));
      expect(restored.querySelectorAll('p')).toHaveLength(2);
      expect(restored.querySelectorAll('pre')).toHaveLength(2);
      expect(restored.lastElementChild?.tagName).toBe('P');
      expect(restored.lastElementChild?.textContent).toBe(`${run}Final paragraph.`);
      expect(Array.from(restored.querySelectorAll('pre code'), node => node.textContent)).toEqual(['alpha\nbeta\n', 'puts :kept\n']);
      expect(restored.querySelector('h1')?.textContent).toBe('Synthetic Full fixture');
      expect(restored.querySelector('h3')?.textContent).toBe('Heading after');
      expect(owner.getRevision()).toBe(revision + 1);
      expect(owner.getHistoryState()).toEqual({ redoDepth: 0, undoDepth: history.undoDepth + 1 });
      expect(window.getSelection()?.anchorNode?.parentElement).toBe(restored.lastElementChild);
      expect(window.getSelection()?.anchorOffset).toBe(run.length);
      metadata.phase = 'formal-followup-input';
      act(() => insertAtNativeCaret(restored, 'x'));
      await waitFor(() => expect(owner.getRevision()).toBe(revision + 2));
      expect(owner.getValue()).toBe(continued);
      expect(owner.getSelection()).toEqual({ direction: 'none', start: point + escapedRun.length + 1, end: point + escapedRun.length + 1 });
      expect(owner.getHistoryState()).toEqual({ redoDepth: 0, undoDepth: history.undoDepth + 2 });
      fireEvent.click(view.getByRole('button', { name: '编辑模式' }));
      await waitFor(() => expect(view.container.querySelector('.easymde-editor')?.classList.contains('is-immersive-source')).toBe(true));
      act(() => { expect(owner.undo()).toBe(true); });
      expect(owner.getValue()).toBe(expected);
      act(() => { expect(owner.redo()).toBe(true); });
      expect(owner.getValue()).toBe(continued);
      expect(props.onFailure).not.toHaveBeenCalled();
      metadata.phase = 'complete';
    } finally { view.unmount(); }
  });
});

it.each(['preedit', 'queued settlement'] as const)('blocks autosave preparation while Full composition owns the DOM (%s)', async (phase) => {
  const props = fixture();
  const initial = 'prefix suffix';
  const point = 7;
  const preedit = "w'o'r'd";
  const committed = 'word';
  const expected = initial.slice(0, point) + committed + initial.slice(point);
  props.submissionField.value = initial;
  props.submissionField.defaultValue = initial;
  props.submissionField.setSelectionRange(point, point);
  const originalCreate = observedSourceAdapter.createCodeMirrorDocumentSession;
  const ownerRef: { current: CodeMirrorDocumentSession | null } = { current: null };
  vi.spyOn(observedSourceAdapter, 'createCodeMirrorDocumentSession').mockImplementation((options) => {
    const owner = originalCreate(options);
    ownerRef.current = owner;
    return owner;
  });
  vi.mocked(props.previewPort.render).mockImplementation(async (request) => ({
    ...createPreviewResponse(request, `<p>${request.markdown}</p>` as SafePreviewHtml, {}),
    editMap: { version: 1, coordinate: 'line', signature: request.signature,
      blocks: [{ id: 'b0', startLine: 0, endLine: 1, editable: true }] }
  }));
  const view = render(<EditorRoot {...props} />);
  try {
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    await waitFor(() => expect(view.getByText('内容已载入')).not.toBeNull());
    fireEvent.click(view.getByRole('button', { name: '解除锁定并编辑' }));
    const surface = await view.findByRole('textbox', { name: '可视化文章编辑器' });
    const owner = ownerRef.current;
    const text = surface.querySelector('p')?.firstChild;
    if (!owner || !(text instanceof Text)) throw new Error('autosave-composition-owner-missing');
    surface.focus();
    window.getSelection()?.collapse(text, point);
    const revision = owner.getRevision();
    const history = owner.getHistoryState();
    act(() => {
      surface.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }));
      surface.dispatchEvent(new CompositionEvent('compositionupdate', { bubbles: true, data: preedit }));
      surface.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, data: preedit, inputType: 'insertCompositionText', isComposing: true }));
      text.insertData(point, preedit);
      window.getSelection()?.collapse(text, point + preedit.length);
      surface.dispatchEvent(new InputEvent('input', { bubbles: true, data: preedit, inputType: 'insertCompositionText', isComposing: true }));
    });
    expect(owner.getValue()).toBe(initial);
    const confirm = () => {
      surface.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter', keyCode: 229, isComposing: true }));
      surface.dispatchEvent(new CompositionEvent('compositionupdate', { bubbles: true, data: committed }));
      surface.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, data: committed, inputType: 'insertCompositionText', isComposing: true }));
      text.replaceData(point, preedit.length, committed);
      window.getSelection()?.collapse(text, point + committed.length - 1);
      surface.dispatchEvent(new InputEvent('input', { bubbles: true, data: committed, inputType: 'insertCompositionText', isComposing: true }));
      surface.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: committed }));
    };
    if (phase === 'queued settlement') act(confirm);
    const nativeOffset = window.getSelection()?.anchorOffset;
    const requests = vi.mocked(props.previewPort.render).mock.calls.length;
    let prepared: EditorSessionAutosavePreparationResult | undefined;
    act(() => { prepared = props.sessionAutosave(); });
    expect(prepared, 'autosave must defer while native composition owns uncommitted DOM').toBe('blocked');
    expect(owner.getValue()).toBe(initial);
    expect(props.submissionField.value).toBe(initial);
    expect(owner.getRevision()).toBe(revision);
    expect(owner.getHistoryState()).toEqual(history);
    expect(vi.mocked(props.previewPort.render).mock.calls.length).toBe(requests);
    expect(window.getSelection()?.anchorNode).toBe(text);
    expect(window.getSelection()?.anchorOffset).toBe(nativeOffset);
    expect(props.onFailure).not.toHaveBeenCalled();
    if (phase === 'preedit') act(confirm);
    await act(async () => { await Promise.resolve(); });
    await waitFor(() => expect(owner.getValue()).toBe(expected));
    expect(owner.getSelection()).toEqual({ direction: 'none', start: point + committed.length, end: point + committed.length });
    expect(window.getSelection()?.anchorNode).toBe(text);
    expect(window.getSelection()?.anchorOffset).toBe(point + committed.length);
    expect(owner.getRevision()).toBe(revision + 1);
    expect(owner.getHistoryState()).toEqual({ redoDepth: 0, undoDepth: history.undoDepth + 1 });
    act(() => { expect(props.sessionAutosave()).toBe('continue'); });
    expect(owner.getValue()).toBe(expected);
    expect(owner.getRevision()).toBe(revision + 1);
    expect(owner.getHistoryState()).toEqual({ redoDepth: 0, undoDepth: history.undoDepth + 1 });
    expect(props.onFailure).not.toHaveBeenCalled();
  } finally {
    view.unmount();
  }
});

it('commits terminal-start Chromium Enter through the real Root canonical owner without jumping to the document start', async ({ task }) => {
  const props = fixture();
  const initial = '# Synthetic heading\n\n\n\nabcdefgh\n\n```python\n\nabcdefghijklmnopqrst\nklmnopqrst0123456789\n```\n\nuvwxyz\n';
  const sourcePoint = initial.indexOf('uvwxyz');
  const entered = initial.slice(0, sourcePoint) + '  \n\n' + initial.slice(sourcePoint);
  const point = sourcePoint + 4;
  const typed = entered.slice(0, point) + 'x' + entered.slice(point);
  props.submissionField.value = initial;
  props.submissionField.defaultValue = initial;
  props.submissionField.setSelectionRange(initial.length, initial.length);
  const originalCreate = observedSourceAdapter.createCodeMirrorDocumentSession;
  const ownerRef: { current: CodeMirrorDocumentSession | null } = { current: null };
  vi.spyOn(observedSourceAdapter, 'createCodeMirrorDocumentSession').mockImplementation((options) => {
    const owner = originalCreate(options); ownerRef.current = owner; return owner;
  });
  vi.mocked(props.previewPort.render).mockImplementation(async (request) => {
    if (request.markdown !== initial && request.markdown !== entered && request.markdown !== typed) {
      throw new Error('terminal-start-preview-unexpected-document');
    }
    const changed = request.markdown !== initial;
    const tail = request.markdown === typed ? 'xuvwxyz' : 'uvwxyz';
    return {
      ...createPreviewResponse(request, `<h1>Synthetic heading</h1><p>abcdefgh</p><pre><code class="language-python">\nabcdefghijklmnopqrst\nklmnopqrst0123456789\n</code></pre><p>${tail}</p>` as SafePreviewHtml, {}),
      editMap: {
        version: 1, coordinate: 'line', signature: request.signature,
        blocks: [
          { id: 'b0', startLine: 0, endLine: 4, editable: true },
          { id: 'b1', startLine: 4, endLine: 6, editable: true },
          { id: 'b2', startLine: 6, endLine: changed ? 14 : 12, editable: true },
          { id: 'b3', startLine: changed ? 14 : 12, endLine: changed ? 16 : 14, editable: true }
        ]
      }
    };
  });
  const view = render(<EditorRoot {...props} />);
  try {
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览' }));
    const unlock = await view.findByRole('button', { name: '解除锁定并编辑' });
    await waitFor(() => expect(unlock.hasAttribute('disabled')).toBe(false));
    layoutPreviewSurface(view.container); fireEvent.click(unlock);
    const surface = await view.findByRole('textbox', { name: '可视化文章编辑器' });
    const owner = ownerRef.current;
    if (!owner) throw new Error('terminal-start-root-document-owner-missing');
    const original = surface.querySelectorAll('p')[1]; const text = original?.firstChild;
    if (!(original instanceof HTMLParagraphElement) || !(text instanceof Text)) throw new Error('terminal-start-root-native-target-missing');
    const protectedPre = surface.querySelector('pre');
    surface.focus(); window.getSelection()?.collapse(text, 0);
    act(() => {
      const key = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter' }); surface.dispatchEvent(key);
      if (key.defaultPrevented) return;
      const range = document.createRange(); range.setStart(text, 0); range.collapse(true);
      const before = new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertParagraph' });
      Object.defineProperty(before, 'getTargetRanges', { value: () => [range] }); surface.dispatchEvent(before);
      expect(before.defaultPrevented).toBe(false);
      const preceding = original.cloneNode(false) as HTMLParagraphElement;
      preceding.append(document.createElement('br')); original.before(preceding);
      window.getSelection()?.collapse(text, 0);
      surface.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertParagraph' }));
    });
    await waitFor(() => expect(owner.getValue() === entered || vi.mocked(props.onFailure).mock.calls.length > 0).toBe(true));
    expect(props.onFailure).not.toHaveBeenCalled();
    expect(owner.getValue()).toBe(entered);
    expect(owner.getSelection()).toEqual({ direction: 'none', start: point, end: point });
    const native = window.getSelection(); const anchor = native?.anchorNode;
    expect(anchor).toBeInstanceOf(Text); expect(anchor?.textContent).toBe('uvwxyz'); expect(native?.anchorOffset).toBe(0);
    expect(surface.querySelector('pre'), 'a native paragraph split must not remount the untouched code frame').toBe(protectedPre);
    if (!(anchor instanceof Text) || !native) throw new Error('terminal-start-root-new-caret-missing');
    act(() => {
      const range = native.getRangeAt(0).cloneRange();
      const before = new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: 'x' });
      Object.defineProperty(before, 'getTargetRanges', { value: () => [range] }); surface.dispatchEvent(before);
      expect(before.defaultPrevented).toBe(false); anchor.insertData(0, 'x'); native.collapse(anchor, 1);
      surface.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'x' }));
    });
    await waitFor(() => expect(owner.getValue()).toBe(typed));
    expect(owner.getSelection()).toEqual({ direction: 'none', start: point + 1, end: point + 1 });
    expect(window.getSelection()?.anchorNode?.textContent).toBe('xuvwxyz'); expect(window.getSelection()?.anchorOffset).toBe(1);
    expect(surface.querySelector('pre code')?.textContent).toBe('\nabcdefghijklmnopqrst\nklmnopqrst0123456789\n');
    expect(props.onFailure).not.toHaveBeenCalled();
  } finally {
    const owner = ownerRef.current; const native = window.getSelection();
    Object.assign(task.meta, { terminalStartRoot: { source: owner?.getValue(), selection: owner?.getSelection(), failures: vi.mocked(props.onFailure).mock.calls.map(call => [...call]), native: { kind: native?.anchorNode?.nodeName, offset: native?.anchorOffset } } });
    view.unmount();
  }
});

it.for(['element', 'text'] as const)('keeps ordinary typing at a nonempty paragraph start after formal lock and repeated history with an omitted source gap (%s target)', async (targetKind, { task }) => {
  const props = fixture();
  const initial = '# Synthetic heading\n\n\n\nabcdefgh\n\n```python\n\nabcdefghijklmnopqrst\nklmnopqrst0123456789\n```\n\nuvwxyz\n';
  const sourcePoint = initial.indexOf('abcdefgh');
  const entered = initial.slice(0, sourcePoint) + '  \n\n' + initial.slice(sourcePoint);
  const point = sourcePoint + 4;
  const typed = entered.slice(0, point) + 'x' + entered.slice(point);
  const continued = entered.slice(0, point) + 'q' + entered.slice(point);
  props.submissionField.value = initial; props.submissionField.defaultValue = initial;
  props.submissionField.setSelectionRange(initial.length, initial.length);
  const originalCreate = observedSourceAdapter.createCodeMirrorDocumentSession;
  const ownerRef: { current: CodeMirrorDocumentSession | null } = { current: null };
  vi.spyOn(observedSourceAdapter, 'createCodeMirrorDocumentSession').mockImplementation((options) => {
    const owner = originalCreate(options); ownerRef.current = owner; return owner;
  });
  vi.mocked(props.previewPort.render).mockImplementation(async (request) => {
    if (![initial, entered, typed, continued].includes(request.markdown)) throw new Error('history-gap-preview-unexpected-document');
    const changed = request.markdown !== initial;
    const body = request.markdown === typed ? 'xabcdefgh' : request.markdown === continued ? 'qabcdefgh' : 'abcdefgh';
    return {
      ...createPreviewResponse(request, `<h1>Synthetic heading</h1><p>${body}</p><pre><code class="language-python">\nabcdefghijklmnopqrst\nklmnopqrst0123456789\n</code></pre><p>uvwxyz</p>` as SafePreviewHtml, {}),
      editMap: {
        version: 1, coordinate: 'line', signature: request.signature,
        blocks: [
          { id: 'b0', startLine: 0, endLine: changed ? 6 : 4, editable: true },
          { id: 'b1', startLine: changed ? 6 : 4, endLine: changed ? 8 : 6, editable: true },
          { id: 'b2', startLine: changed ? 8 : 6, endLine: changed ? 14 : 12, editable: true },
          { id: 'b3', startLine: changed ? 14 : 12, endLine: changed ? 16 : 14, editable: true }
        ]
      }
    };
  });
  const view = render(<EditorRoot {...props} />);
  const currentSurface = () => view.getByRole('textbox', { name: '可视化文章编辑器' });
  const typeAtCurrentCaret = (character: string) => {
    const surface = currentSurface();
    const key = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: character }); surface.dispatchEvent(key);
    if (key.defaultPrevented) return;
    const native = window.getSelection();
    if (!native || !native.rangeCount || !native.isCollapsed) throw new Error('history-gap-native-caret-missing');
    const range = native.getRangeAt(0).cloneRange();
    const targetRange = range.cloneRange();
    if (targetKind === 'text' && targetRange.startContainer instanceof HTMLParagraphElement && targetRange.startOffset === 0) {
      const first = targetRange.startContainer.firstChild;
      if (!(first instanceof Text) || !first.data.length) throw new Error('history-gap-equivalent-text-target-missing');
      targetRange.setStart(first, 0); targetRange.collapse(true);
    }
    const before = new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: character });
    Object.defineProperty(before, 'getTargetRanges', { value: () => [targetRange] }); surface.dispatchEvent(before);
    if (before.defaultPrevented) return;
    const container = range.startContainer;
    const text = container instanceof Text ? container : container.childNodes[range.startOffset];
    if (text instanceof Text) {
      const offset = container instanceof Text ? range.startOffset : 0;
      text.insertData(offset, character); native.collapse(text, offset + character.length);
    } else {
      const next = document.createTextNode(character); range.insertNode(next); native.collapse(next, character.length);
    }
    surface.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: character }));
  };
  try {
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' })); fireEvent.click(view.getByRole('button', { name: '预览' }));
    const unlock = await view.findByRole('button', { name: '解除锁定并编辑' });
    await waitFor(() => expect(unlock.hasAttribute('disabled')).toBe(false)); layoutPreviewSurface(view.container); fireEvent.click(unlock);
    const surface = await view.findByRole('textbox', { name: '可视化文章编辑器' }); const owner = ownerRef.current;
    if (!owner) throw new Error('history-gap-root-source-owner-missing');
    const original = surface.querySelector('p'); const text = original?.firstChild;
    if (!(original instanceof HTMLParagraphElement) || !(text instanceof Text)) throw new Error('history-gap-root-original-paragraph-missing');
    surface.focus(); window.getSelection()?.collapse(text, 0);
    act(() => {
      const key = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter' }); surface.dispatchEvent(key);
      if (key.defaultPrevented) return;
      const range = document.createRange(); range.setStart(text, 0); range.collapse(true);
      const before = new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertParagraph' });
      Object.defineProperty(before, 'getTargetRanges', { value: () => [range] }); surface.dispatchEvent(before);
      if (before.defaultPrevented) return;
      const preceding = original.cloneNode(false) as HTMLParagraphElement; preceding.append(document.createElement('br')); original.before(preceding);
      window.getSelection()?.collapse(text, 0); surface.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertParagraph' }));
    });
    await waitFor(() => expect(owner.getValue()).toBe(entered));
    expect(owner.getSelection()).toEqual({ direction: 'none', start: point, end: point });
    act(() => typeAtCurrentCaret('x')); await waitFor(() => expect(owner.getValue()).toBe(typed));
    const lock = view.getByRole('button', { name: '锁定为只读' }); lock.focus(); fireEvent.click(lock);
    const freshUnlock = await view.findByRole('button', { name: '解除锁定并编辑' });
    await waitFor(() => expect(freshUnlock.hasAttribute('disabled')).toBe(false)); layoutPreviewSurface(view.container); fireEvent.click(freshUnlock);
    await view.findByRole('textbox', { name: '可视化文章编辑器' });
    await waitFor(() => expect(window.getSelection()?.anchorNode?.textContent).toBe('xabcdefgh'));
    const historyKey = (redo: boolean) => {
      const current = currentSurface(); current.focus();
      current.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ctrlKey: true, key: 'z', shiftKey: redo }));
    };
    act(() => historyKey(false)); await waitFor(() => expect(owner.getValue()).toBe(entered));
    await waitFor(() => expect(window.getSelection()?.anchorNode?.textContent).toBe('abcdefgh'));
    act(() => historyKey(true)); await waitFor(() => expect(owner.getValue()).toBe(typed));
    await waitFor(() => expect(window.getSelection()?.anchorNode?.textContent).toBe('xabcdefgh'));
    act(() => historyKey(false)); await waitFor(() => expect(owner.getValue()).toBe(entered));
    await waitFor(() => expect(window.getSelection()?.anchorNode?.textContent).toBe('abcdefgh'));
    expect(window.getSelection()?.anchorOffset).toBe(0);
    expect(owner.getSelection()).toEqual({ direction: 'none', start: point, end: point });
    const protectedPre = currentSurface().querySelector('pre');
    act(() => typeAtCurrentCaret('q'));
    await waitFor(() => expect(owner.getValue() === continued || vi.mocked(props.onFailure).mock.calls.length > 0).toBe(true));
    expect(props.onFailure, 'typing is a normal paragraph edit, not an empty structural input').not.toHaveBeenCalled();
    expect(owner.getValue()).toBe(continued);
    expect(owner.getSelection()).toEqual({ direction: 'none', start: point + 1, end: point + 1 });
    expect(window.getSelection()?.anchorNode?.textContent).toBe('qabcdefgh'); expect(window.getSelection()?.anchorOffset).toBe(1);
    expect(currentSurface().querySelector('pre'), 'ordinary input must not rebuild the unrelated code frame').toBe(protectedPre);
  } finally {
    const owner = ownerRef.current; const native = window.getSelection();
    Object.assign(task.meta, { ordinaryHistoryGap: { source: owner?.getValue(), selection: owner?.getSelection(), failures: vi.mocked(props.onFailure).mock.calls.map(call => [...call]), native: { kind: native?.anchorNode?.nodeName, offset: native?.anchorOffset } } });
    view.unmount();
  }
});

import { syncCodeFrameBackgrounds } from '../../integrations/preview-runtime/frontend-enhancement-runtime';

it('keeps native-created Full code body typing editable through the real Root code-frame background owner', { timeout: 15_000 }, async ({ task }) => {
  const props = fixture();
  const anchorText = 'Writing anchor';
  const initial = '# Synthetic heading\n\n\n\nWriting anchor\n\n```python\nPROTECTED_NEIGHBOR\n```\n\nTail stays.';
  const anchorEnd = initial.indexOf(anchorText) + anchorText.length;
  const prefix = initial.slice(0, anchorEnd) + '\n\n';
  const suffix = initial.slice(anchorEnd);
  const paragraphPoint = prefix.length;
  const entered = prefix + '  ' + suffix;
  const literal = prefix + '\\~\\~\\~bash' + suffix;
  const nativeCodeSource = (body: string) => prefix + '```bash\n' + body + '\n```' + suffix;
  const bodyPoint = paragraphPoint + '```bash\n'.length;
  props.submissionField.value = initial;
  props.submissionField.defaultValue = initial;
  props.submissionField.setSelectionRange(0, 0);
  const theme = document.createElement('style');
  theme.textContent = 'code.hljs { background-color: rgb(12, 34, 56); }';
  document.head.append(theme);
  // The initial formal candidate is enhanced before admission, including its
  // existing neighbor PRE. Only the real Root callback enhances the new PRE.
  vi.mocked(props.enhancementPort.enhance).mockImplementation(async (surface) => {
    syncCodeFrameBackgrounds(surface, window);
  });
  vi.mocked(props.enhancementPort.syncCodeFrameBackgrounds).mockImplementation((surface) => {
    syncCodeFrameBackgrounds(surface, window);
  });
  const escapeHtml = (value: string) => value.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;');
  vi.mocked(props.previewPort.render).mockImplementation(async (request) => {
    const blocks = observedBlockIndex(request.markdown).blocks;
    const html = blocks.map((block, index) => {
      const raw = request.markdown.slice(block.from, block.to).replace(/\n+$/u, '');
      const marker = ` data-easymde-visual-block-id="b${index}"`;
      if ('code' === block.kind) {
        const lines = raw.split('\n');
        const opening = /^(`{3,}|~{3,})([a-zA-Z0-9_-]*)$/u.exec(lines[0] ?? '');
        if (!opening || lines.at(-1) !== opening[1]) throw new Error('root-native-frame-formal-fence-invalid');
        return `<pre${marker}><code class="hljs language-${opening[2]}">${escapeHtml(lines.slice(1, -1).join('\n') + '\n')}</code></pre>`;
      }
      if ('heading' === block.kind) {
        const heading = /^(#{1,6}) (.*)$/u.exec(raw);
        if (!heading) throw new Error('root-native-frame-formal-heading-invalid');
        return `<h${heading[1]!.length}${marker}>${escapeHtml(heading[2]!)}</h${heading[1]!.length}>`;
      }
      if ('paragraph' !== block.kind) throw new Error('root-native-frame-formal-block-unsupported');
      return `<p${marker}>${escapeHtml(raw.replace(/\\([~`\\])/gu, '$1'))}</p>`;
    }).join('');
    return {
      features: {}, html: html as SafePreviewHtml,
      editMap: {
        version: 1, coordinate: 'line', signature: request.signature,
        blocks: blocks.map((block, index) => ({
          id: `b${index}`, startLine: block.lineStart, endLine: block.lineEnd + 1, editable: true
        }))
      }
    };
  });
  const sessions = vi.spyOn(observedSourceAdapter, 'createCodeMirrorDocumentSession');
  const receipt = {
    phase: 'setup', admitted: false, realBackgroundReached: false,
    classification: 'SETUP_PENDING', steps: [] as unknown[], error: null as string | null,
    failedPhase: null as string | null
  };
  Object.assign(task.meta, { rootNativeCodeFrame: receipt });
  const view = render(<EditorRoot {...props} />);
  let owner: CodeMirrorDocumentSession | null = null;
  let surface: HTMLElement | null = null;
  const capture = (phase: string) => {
    receipt.phase = phase;
    const native = window.getSelection();
    receipt.steps.push({
      phase, value: owner?.getValue(), selection: owner?.getSelection(),
      revision: owner?.getRevision(), history: owner?.getHistoryState(),
      bridge: { value: props.submissionField.value, start: props.submissionField.selectionStart,
        end: props.submissionField.selectionEnd, direction: props.submissionField.selectionDirection },
      native: { connected: native?.anchorNode?.isConnected, node: native?.anchorNode?.nodeName,
        text: native?.anchorNode?.textContent, offset: native?.anchorOffset, collapsed: native?.isCollapsed },
      editable: surface?.getAttribute('contenteditable'), phaseAttribute: surface?.getAttribute('data-easymde-preview-phase'),
      refreshing: surface?.getAttribute('data-easymde-preview-refreshing'),
      frames: Array.from(surface?.querySelectorAll('pre') ?? []).map((pre) => ({
        style: pre.getAttribute('style'), text: pre.querySelector('code')?.textContent
      })),
      requests: vi.mocked(props.previewPort.render).mock.calls.map(([request]) => ({ markdown: request.markdown, signature: request.signature })),
      failures: vi.mocked(props.onFailure).mock.calls.map(([code]) => code)
    });
  };
  try {
    fireEvent.click(await view.findByRole('button', { name: '进入沉浸写作' }));
    fireEvent.click(view.getByRole('button', { name: '预览模式' }));
    const unlock = await view.findByRole('button', { name: '解除锁定并编辑' });
    await waitFor(() => expect(unlock.hasAttribute('disabled')).toBe(false));
    layoutPreviewSurface(view.container);
    fireEvent.click(unlock);
    surface = await view.findByRole('textbox', { name: '可视化文章编辑器' });
    const visual = surface;
    await waitFor(() => expect(visual.getAttribute('contenteditable')).toBe('true'));
    const creation = sessions.mock.results[0];
    if (!creation || 'return' !== creation.type) throw new Error('root-native-frame-real-document-missing');
    owner = creation.value;
    const documentOwner = owner;
    const anchor = visual.querySelector('p');
    const anchorNode = anchor?.firstChild;
    const protectedPre = visual.querySelector('pre');
    const protectedCode = protectedPre?.querySelector('code');
    if (!(anchor instanceof HTMLParagraphElement) || !(anchorNode instanceof Text)
      || !(protectedPre instanceof HTMLPreElement) || !(protectedCode instanceof HTMLElement)) {
      throw new Error('root-native-frame-formal-neighbors-missing');
    }
    expect(anchor.textContent).toBe(anchorText);
    expect(visual.querySelector('[data-easymde-preview-window-spacer]')).toBeNull();
    expect(protectedPre.style.getPropertyValue('--easymde-code-frame-background')).toBe(window.getComputedStyle(protectedCode).backgroundColor);
    expect(protectedPre.style.getPropertyValue('--easymde-code-frame-background')).toBe('rgb(12, 34, 56)');
    const protectedHtml = protectedPre.outerHTML;
    const initialRevision = documentOwner.getRevision();
    const assertHealthy = () => {
      expect(props.onFailure, receipt.phase).not.toHaveBeenCalled();
      expect(view.container.querySelector('[role="alert"]'), receipt.phase).toBeNull();
      expect(visual.getAttribute('contenteditable'), receipt.phase).toBe('true');
      expect(protectedPre.isConnected).toBe(true);
      expect(protectedPre.outerHTML).toBe(protectedHtml);
      expect(visual.querySelector('pre code.language-python')).toBe(protectedCode);
    };
    const assertNativeAt = (root: HTMLElement, offset: number) => {
      const native = window.getSelection();
      expect(native?.isCollapsed, receipt.phase).toBe(true);
      for (const [node, point] of [[native?.anchorNode, native?.anchorOffset], [native?.focusNode, native?.focusOffset]] as const) {
        if (!node || point === undefined || !node.isConnected || !root.contains(node)) {
          throw new Error(`root-native-frame-live-caret-missing:${receipt.phase}`);
        }
        const range = document.createRange();
        range.selectNodeContents(root); range.setEnd(node, point);
        expect(range.toString().length, receipt.phase).toBe(offset);
      }
      expect(document.activeElement).toBe(visual);
    };
    const assertDocument = (expected: string, caret: number) => {
      expect(documentOwner.getValue(), receipt.phase).toBe(expected);
      expect(props.submissionField.value, receipt.phase).toBe(expected);
      expect(documentOwner.getSelection(), receipt.phase).toEqual({ direction: 'none', start: caret, end: caret });
      expect([props.submissionField.selectionStart, props.submissionField.selectionEnd]).toEqual([caret, caret]);
      expect(documentOwner.getHistoryState().redoDepth).toBe(0);
      assertHealthy();
    };
    const key = (name: string) => {
      const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: name });
      visual.dispatchEvent(event); return event;
    };
    const typeNativeGlyph = (character: string, root: HTMLElement, offset: number) => {
      assertNativeAt(root, offset);
      expect(key(character).defaultPrevented, receipt.phase).toBe(false);
      const native = window.getSelection();
      const range = native?.rangeCount ? native.getRangeAt(0).cloneRange() : null;
      if (!native || !range) throw new Error('root-native-frame-input-range-missing');
      const before = new InputEvent('beforeinput', { bubbles: true, cancelable: true, data: character, inputType: 'insertText' });
      Object.defineProperty(before, 'getTargetRanges', { value: () => [range.cloneRange()] });
      visual.dispatchEvent(before);
      expect(before.defaultPrevented, receipt.phase).toBe(false);
      if (range.startContainer instanceof Text) {
        const node = range.startContainer, point = range.startOffset;
        node.insertData(point, character); native.collapse(node, point + character.length);
      } else {
        const node = document.createTextNode(character);
        if (root instanceof HTMLParagraphElement && !root.textContent && root.firstChild instanceof HTMLBRElement) root.replaceChildren(node);
        else range.insertNode(node);
        native.collapse(node, character.length);
      }
      visual.dispatchEvent(new InputEvent('input', { bubbles: true, data: character, inputType: 'insertText' }));
      assertNativeAt(root, offset + character.length);
      assertHealthy();
    };
    capture('initial formally enhanced Full admission');
    assertDocument(initial, 0);
    visual.focus(); window.getSelection()?.collapse(anchorNode, anchorNode.length);
    act(() => {
      receipt.phase = 'genuine cloned-ID Enter';
      assertNativeAt(anchor, anchorText.length);
      expect(key('Enter').defaultPrevented).toBe(false);
      const native = window.getSelection();
      const range = native?.rangeCount ? native.getRangeAt(0).cloneRange() : null;
      if (!native || !range) throw new Error('root-native-frame-Enter-range-missing');
      const before = new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertParagraph' });
      Object.defineProperty(before, 'getTargetRanges', { value: () => [range] });
      visual.dispatchEvent(before);
      expect(before.defaultPrevented).toBe(false);
      const created = anchor.cloneNode(false) as HTMLParagraphElement;
      created.append(document.createElement('br')); anchor.after(created); native.collapse(created, 0);
      expect(created.getAttribute('data-easymde-visual-block-id')).toBe(anchor.getAttribute('data-easymde-visual-block-id'));
      visual.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertParagraph' }));
    });
    await waitFor(() => expect(documentOwner.getValue() === entered || vi.mocked(props.onFailure).mock.calls.length > 0).toBe(true));
    capture('genuine cloned-ID Enter committed');
    assertDocument(entered, paragraphPoint);
    const createdParagraph = anchor.nextElementSibling;
    if (!(createdParagraph instanceof HTMLParagraphElement)) throw new Error('root-native-frame-cloned-paragraph-missing');
    assertNativeAt(createdParagraph, 0);
    receipt.admitted = true;
    act(() => {
      for (const [index, character] of Array.from('~~~bash').entries()) {
        receipt.phase = `literal prefix glyph ${index + 1}`;
        typeNativeGlyph(character, createdParagraph, index);
      }
    });
    await waitFor(() => expect(documentOwner.getValue() === literal || vi.mocked(props.onFailure).mock.calls.length > 0).toBe(true));
    capture('literal prefix committed before explicit Enter');
    assertDocument(literal, paragraphPoint + '\\~\\~\\~bash'.length);
    assertNativeAt(createdParagraph, '~~~bash'.length);
    act(() => {
      receipt.phase = 'explicit Enter creates code frame';
      expect(key('Enter').defaultPrevented).toBe(true);
    });
    capture('created code frame with real Root background sync');
    assertDocument(nativeCodeSource(''), bodyPoint);
    const createdPre = anchor.nextElementSibling;
    const createdCode = createdPre?.querySelector('code');
    if (!(createdPre instanceof HTMLPreElement) || !(createdCode instanceof HTMLElement)) throw new Error('root-native-frame-created-code-missing');
    expect(createdPre).not.toBe(protectedPre);
    expect(createdCode.classList.contains('hljs')).toBe(true);
    expect(createdCode.classList.contains('language-bash')).toBe(true);
    expect(createdCode.querySelector('[data-easymde-visual-code-placeholder]')).not.toBeNull();
    expect(createdPre.style.getPropertyValue('--easymde-code-frame-background')).toBe(window.getComputedStyle(createdCode).backgroundColor);
    expect(createdPre.style.getPropertyValue('--easymde-code-frame-background')).toBe('rgb(12, 34, 56)');
    receipt.realBackgroundReached = true;
    assertNativeAt(createdCode, 0);
    const beforeBody = { revision: documentOwner.getRevision(), history: documentOwner.getHistoryState() };
    // No ready wait, per-glyph debounce flush, or test caret placement after
    // the explicit Enter. Both defaults consume the actual current Selection.
    act(() => {
      receipt.phase = 'created body native x';
      typeNativeGlyph('x', createdCode, 0);
      capture(receipt.phase);
      receipt.phase = 'created body native y';
      typeNativeGlyph('y', createdCode, 1);
      capture(receipt.phase);
    });
    await waitFor(() => expect(documentOwner.getValue() === nativeCodeSource('xy') || vi.mocked(props.onFailure).mock.calls.length > 0).toBe(true));
    capture('created body xy committed');
    assertDocument(nativeCodeSource('xy'), bodyPoint + 2);
    assertNativeAt(createdCode, 2);
    expect(visual.querySelectorAll('pre')).toHaveLength(2);
    expect(documentOwner.getRevision() - beforeBody.revision).toBeGreaterThanOrEqual(1);
    expect(documentOwner.getRevision() - beforeBody.revision).toBeLessThanOrEqual(2);
    expect(documentOwner.getHistoryState().undoDepth - beforeBody.history.undoDepth).toBeGreaterThanOrEqual(1);
    expect(documentOwner.getHistoryState().undoDepth - beforeBody.history.undoDepth).toBeLessThanOrEqual(2);
    expect(documentOwner.getRevision()).toBeGreaterThan(initialRevision);
    receipt.classification = 'GREEN';
  } catch (error) {
    receipt.failedPhase = receipt.phase;
    receipt.error = error instanceof Error ? error.message : String(error);
    receipt.classification = receipt.admitted ? 'CONSUMER_RED' : 'SETUP_FAILURE';
    capture(receipt.phase);
    throw error;
  } finally {
    capture('final receipt');
    view.unmount(); theme.remove();
  }
});
