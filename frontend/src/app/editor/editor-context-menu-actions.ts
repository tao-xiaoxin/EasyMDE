import type { AppearanceState } from '../../contracts/bootstrap/appearance-bootstrap';
import type { MediaPickerDocumentPort } from '../../contracts/ports/media-picker-port';
import type { PreviewRequestPort } from '../../contracts/ports/preview-request';
import type { RemoteImageImportPort } from '../../contracts/ports/remote-image-import-port';
import type { EditorDocumentSession } from '../../features/document-source/ui/EditorDocumentSource';
import type { EditorContextMenuActionCapabilities } from '../../features/editor-context-menu/editor-context-menu-action-coordinator';
import type { EditorContextMenuBlockIndexCache } from '../../features/editor-context-menu/editor-context-menu-block-index-cache';
import {
  type EditorContextSnapshot,
  findMarkdownBlock,
  insertMarkdownBlockRelative,
  isEditorContextCurrent
} from '../../features/editor-context-menu/editor-context-menu-rules';
import { tableMarkdown } from '../../features/immersive-editor/immersive-editor';
import {
  documentPort,
  previewRequest,
  visualMediaPickerDocument
} from './editor-root-helpers';
import type {
  ApplyVisualCanonicalChange,
  ContextMenuTableRequest,
  EditorRootProps,
  ImmersiveVisualEditorRuntime,
  SharedRef
} from './editor-root-types';

export type CreateContextMenuActionCapabilitiesDeps = Readonly<{
  appearance: EditorRootProps['appearance'];
  applyVisualCanonicalChangeRef: SharedRef<ApplyVisualCanonicalChange>;
  contextMenuBlockIndexCacheRef: SharedRef<EditorContextMenuBlockIndexCache | null>;
  contextMenuExecutorRef: SharedRef<((commandId: string) => void) | null>;
  contextMenuStrings: EditorRootProps['contextMenuStrings'];
  documentSession: EditorDocumentSession | null;
  editorBlockIndexPort: EditorRootProps['editorBlockIndexPort'];
  editorClipboardPort: EditorRootProps['editorClipboardPort'];
  editorCodeIndentationCandidateSequenceRef: SharedRef<number>;
  editorImagePixelsPort: EditorRootProps['editorImagePixelsPort'];
  generatedContentExportSession: EditorRootProps['generatedContentExportSession'];
  getNextPreviewRevision: () => number;
  imageUpload: EditorRootProps['imageUpload'];
  openMediaPicker: (
    session: EditorDocumentSession,
    pickerDocument?: MediaPickerDocumentPort
  ) => Promise<unknown>;
  prepareGeneratedSourceNavigation: (
    expected: Readonly<{ revision: number; value: string }>,
    validateSource: () => boolean
  ) => boolean;
  preview: EditorRootProps['preview'];
  previewAppearanceRef: SharedRef<AppearanceState>;
  previewPort: PreviewRequestPort;
  readContextMenuCurrentContext: (
    surface: EditorContextSnapshot['surface']
  ) =>
    | ReturnType<
        NonNullable<
          EditorContextMenuActionCapabilities['document']
        >['getCurrentContext']
      >
    | null;
  remoteImageImportPort: RemoteImageImportPort;
  reportContextMenuFailure: (code: string, message?: string) => void;
  rootActiveRef: SharedRef<boolean>;
  setContextMenuTableRequest: (request: ContextMenuTableRequest | null) => void;
  simplifiedFormattingParser: EditorRootProps['simplifiedFormattingParser'];
  toolbar: EditorRootProps['toolbar'];
  visualEditorGeneration: number;
  visualEditorRuntimeRef: SharedRef<ImmersiveVisualEditorRuntime | null>;
}>;

export function createContextMenuActionCapabilities(
  deps: CreateContextMenuActionCapabilitiesDeps
): EditorContextMenuActionCapabilities {
  const {
    appearance,
    applyVisualCanonicalChangeRef,
    contextMenuBlockIndexCacheRef,
    contextMenuExecutorRef,
    contextMenuStrings,
    documentSession,
    editorBlockIndexPort,
    editorClipboardPort,
    editorCodeIndentationCandidateSequenceRef,
    editorImagePixelsPort,
    generatedContentExportSession,
    getNextPreviewRevision,
    imageUpload,
    openMediaPicker,
    prepareGeneratedSourceNavigation,
    preview,
    previewAppearanceRef,
    previewPort,
    readContextMenuCurrentContext,
    remoteImageImportPort,
    reportContextMenuFailure,
    rootActiveRef,
    setContextMenuTableRequest,
    simplifiedFormattingParser,
    toolbar,
    visualEditorGeneration,
    visualEditorRuntimeRef
  } = deps;

  return {
    ...(editorClipboardPort ? { clipboard: editorClipboardPort } : {}),
    ...(contextMenuStrings ? { contextMenuStrings } : {}),
    document: documentSession
      ? {
          applyTextChange: (change) =>
            documentSession.document.applyTextChange(change),
          getBlockIndex: (surface) => {
            if (!editorBlockIndexPort) return undefined;
            const revision = documentSession.document.getRevision?.();
            const owner =
              'source' === surface
                ? documentSession
                : visualEditorRuntimeRef.current;
            if (undefined === revision || !owner) return null;
            const index = contextMenuBlockIndexCacheRef.current?.peek({
              generation: 'source' === surface ? 0 : visualEditorGeneration,
              owner,
              revision
            });
            return index && index.source === documentSession.document.getValue()
              ? index
              : null;
          },
          getCurrentContext: (surface) => {
            const current = readContextMenuCurrentContext(surface);
            if (!current) {
              throw new Error('editor-context-menu-owner-unavailable');
            }
            return current;
          },
          getSelection: () => documentSession.document.getSelection(),
          getValue: () => documentSession.document.getValue(),
          isEditable: () => documentSession.document.isEditable(),
          revealPosition: (position) =>
            documentSession.document.revealPosition(position),
          subscribe: (listener) => documentSession.document.subscribe(listener),
          subscribeSelection: (listener) =>
            documentSession.document.subscribeSelection(listener)
        }
      : null,
    generated: {
      ...(generatedContentExportSession
        ? { exportSession: generatedContentExportSession }
        : {}),
      prepareSourceNavigation: (expected, validateSource) =>
        prepareGeneratedSourceNavigation(expected, validateSource)
    },
    isActive: () => rootActiveRef.current,
    media: {
      ...(editorImagePixelsPort ? { imagePixels: editorImagePixelsPort } : {}),
      imageUpload: {
        postId: imageUpload.postId,
        remoteImageUploadMode: imageUpload.remoteImageUploadMode
      },
      openInsertion: (captured, block, direction) => {
        if (!documentSession) return;
        const position = 'above' === direction ? block.start : block.end;
        const insertionSelection = {
          direction: 'none' as const,
          end: position,
          start: position
        };
        const formatInsertion = (currentValue: string, inserted: string) =>
          insertMarkdownBlockRelative(currentValue, block, direction, inserted);
        const runtime =
          'visual' === captured.surface ? visualEditorRuntimeRef.current : null;
        const apply =
          'visual' === captured.surface
            ? applyVisualCanonicalChangeRef.current
            : null;
        if ('visual' === captured.surface && (!runtime || !apply)) {
          reportContextMenuFailure(
            'editor-context-menu-visual-selection-unavailable',
            contextMenuStrings?.statusActionFailed
          );
          return;
        }
        const visualCaptured = 'visual' === captured.surface ? captured : null;
        const pickerDocument =
          runtime && apply && visualCaptured
            ? visualMediaPickerDocument(
                documentSession,
                visualCaptured,
                () => rootActiveRef.current,
                () => runtime.surface.focus(),
                apply,
                insertionSelection,
                formatInsertion
              )
            : documentPort(
                documentSession,
                () => rootActiveRef.current,
                insertionSelection,
                formatInsertion
              );
        void openMediaPicker(documentSession, pickerDocument);
      },
      remoteImageImport: remoteImageImportPort,
      requestTableInsertion: (captured, direction) =>
        setContextMenuTableRequest({
          ...captured,
          insertionDirection: direction
        })
    },
    preview: {
      render: (markdown, signal) =>
        previewPort.render(
          previewRequest(
            markdown,
            preview,
            previewAppearanceRef.current,
            getNextPreviewRevision()
          ),
          signal
        ),
      renderCodeIndentationCandidate: async (markdown, signal) => {
        const defaultArticleTheme = appearance.articleThemes.find(
          ({ id }) => 'default' === id
        );
        if (
          !defaultArticleTheme
          || !appearance.codeThemes.some(
            ({ id }) => id === defaultArticleTheme.defaultCodeTheme
          )
        ) {
          return {
            code: 'editor-code-projection-candidate-unavailable',
            status: 'unavailable' as const
          };
        }
        const signature = `editor-code-indent-candidate:${++editorCodeIndentationCandidateSequenceRef.current}`;
        const response = await previewPort.render(
          {
            codeTheme: defaultArticleTheme.defaultCodeTheme,
            customCssId: '',
            markdown,
            markdownTheme: defaultArticleTheme.id,
            postId: preview.postId,
            signature
          },
          signal
        );
        return { response, signature, status: 'available' as const };
      }
    },
    report: reportContextMenuFailure,
    ...(simplifiedFormattingParser ? { simplifiedFormattingParser } : {}),
    toolbar: {
      commands: toolbar.commands,
      execute: (commandId) => {
        const execute = contextMenuExecutorRef.current;
        if (!execute) return false;
        execute(commandId);
        return true;
      }
    },
    visual: {
      applyCanonicalChange: (captured, change) =>
        applyVisualCanonicalChangeRef.current?.(captured, change) ?? false,
      executeCommand: (command, options) => {
        const runtime = visualEditorRuntimeRef.current;
        if (!runtime) return 'unavailable';
        const result = runtime.executeCommand(command, options);
        return 'handled' === result ? 'handled' : 'failed';
      },
      isEditable: () => Boolean(visualEditorRuntimeRef.current?.isEditable())
    }
  };
}

export type ExecuteContextMenuTableInsertionDeps = Readonly<{
  applyVisualCanonicalChange: ApplyVisualCanonicalChange;
  columns: number;
  contextMenuBlockIndexCacheRef: SharedRef<EditorContextMenuBlockIndexCache | null>;
  contextMenuStrings: EditorRootProps['contextMenuStrings'];
  documentSession: EditorDocumentSession | null;
  editorBlockIndexPort: EditorRootProps['editorBlockIndexPort'];
  reportContextMenuFailure: (code: string, message?: string) => void;
  request: ContextMenuTableRequest | null;
  rows: number;
  setContextMenuTableRequest: (request: ContextMenuTableRequest | null) => void;
  visualEditorGeneration: number;
  visualEditorRuntimeRef: SharedRef<ImmersiveVisualEditorRuntime | null>;
}>;

export function executeContextMenuTableInsertion(
  deps: ExecuteContextMenuTableInsertionDeps
): void {
  const {
    applyVisualCanonicalChange,
    columns,
    contextMenuBlockIndexCacheRef,
    contextMenuStrings,
    documentSession,
    editorBlockIndexPort,
    reportContextMenuFailure,
    request,
    rows,
    setContextMenuTableRequest,
    visualEditorGeneration,
    visualEditorRuntimeRef
  } = deps;

  if (!request || !documentSession) {
    setContextMenuTableRequest(null);
    reportContextMenuFailure(
      'editor-context-menu-table-dialog-stale',
      contextMenuStrings?.statusActionFailed
    );
    return;
  }
  const revision = documentSession.document.getRevision?.();
  const current = {
    ...(undefined === revision ? {} : { revision }),
    selection: documentSession.document.getSelection(),
    ...('source' === request.surface
      ? { surfaceIdentity: documentSession }
      : visualEditorRuntimeRef.current
        ? {
            surfaceGeneration: visualEditorGeneration,
            surfaceIdentity: visualEditorRuntimeRef.current
          }
        : {}),
    surface: request.surface,
    value: documentSession.document.getValue()
  };
  if (!isEditorContextCurrent(request, current)) {
    setContextMenuTableRequest(null);
    reportContextMenuFailure(
      'editor-context-menu-context-stale',
      contextMenuStrings?.statusActionFailed
    );
    return;
  }
  const indexRevision = documentSession.document.getRevision?.();
  const indexOwner =
    'source' === request.surface
      ? documentSession
      : visualEditorRuntimeRef.current;
  const blockIndex =
    editorBlockIndexPort && undefined !== indexRevision && indexOwner
      ? (contextMenuBlockIndexCacheRef.current?.peek({
          generation: 'source' === request.surface ? 0 : visualEditorGeneration,
          owner: indexOwner,
          revision: indexRevision
        }) ?? undefined)
      : undefined;
  const insertion = tableMarkdown(rows, columns);
  const value = documentSession.document.getValue();
  const usableBlockIndex =
    blockIndex && blockIndex.source === value ? blockIndex : undefined;
  const block = findMarkdownBlock(
    value,
    request.selection.start,
    usableBlockIndex
  );
  if (!block) {
    setContextMenuTableRequest(null);
    reportContextMenuFailure(
      'editor-context-menu-insertion-target-unavailable',
      contextMenuStrings?.unsupported
    );
    return;
  }
  const change = insertMarkdownBlockRelative(
    value,
    block,
    request.insertionDirection,
    insertion
  );
  if (!change.changes) {
    setContextMenuTableRequest(null);
    reportContextMenuFailure(
      'editor-context-menu-insertion-change-missing',
      contextMenuStrings?.statusActionFailed
    );
    return;
  }
  const canonicalChange = {
    changes: change.changes,
    selection: change.selection,
    value: change.value
  };
  let applied: boolean;
  if ('visual' === request.surface) {
    applied = applyVisualCanonicalChange(request, canonicalChange);
  } else if (!documentSession.document.isEditable()) {
    // The dialog can stay open while the authoritative field becomes
    // read-only or disabled. Confirming it must then fail explicitly and
    // write neither the canonical document nor history.
    setContextMenuTableRequest(null);
    reportContextMenuFailure(
      'editor-context-menu-surface-read-only',
      contextMenuStrings?.statusActionFailed
    );
    return;
  } else {
    documentSession.document.applyTextChange(canonicalChange);
    applied = true;
  }
  if (!applied) {
    setContextMenuTableRequest(null);
    return;
  }
  setContextMenuTableRequest(null);
  if ('source' === request.surface) documentSession.document.focus();
}
