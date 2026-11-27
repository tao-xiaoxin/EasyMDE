import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from '@wordpress/element';

import type { AppearanceState } from '../../contracts/bootstrap/appearance-bootstrap';
import type { MediaPickerDocumentPort } from '../../contracts/ports/media-picker-port';
import type { PreviewRequestPort } from '../../contracts/ports/preview-request';
import type { RemoteImageImportPort } from '../../contracts/ports/remote-image-import-port';
import type { EditorDocumentSession } from '../../features/document-source/ui/EditorDocumentSource';
import type { EditorContextMenuSurface } from '../../features/editor-context-menu/EditorContextMenuFeature';
import {
  type EditorCodeContentQueryBinding,
  type EditorCodeContentQuerySession,
  createEditorCodeContentQuery
} from '../../features/editor-context-menu/editor-code-content-query';
import {
  type EditorContextMenuActionCapabilities,
  type EditorContextMenuActionCoordinator,
  createEditorContextMenuActionCoordinator
} from '../../features/editor-context-menu/editor-context-menu-action-coordinator';
import {
  type EditorContextMenuBlockIndexCache,
  createEditorContextMenuBlockIndexCache
} from '../../features/editor-context-menu/editor-context-menu-block-index-cache';
import {
  type EditorContextSnapshot,
  isEditorContextCurrent
} from '../../features/editor-context-menu/editor-context-menu-rules';
import type { EditorMarkdownBlockIndex } from '../../features/editor-context-menu/editor-markdown-block-index';
import {
  type EditorSourceLinkQueryBinding,
  type EditorSourceLinkQuerySession,
  createEditorSourceLinkQuery
} from '../../features/editor-context-menu/editor-source-link-query';
import type { PreviewSurfaceRuntime } from '../../features/live-preview/ui/PreviewSurfaceOwner';
import { createBrowserEditorImageHydrationScheduler } from '../../integrations/browser/editor-context-menu/create-browser-editor-image-hydration-scheduler';
import {
  createContextMenuActionCapabilities,
  executeContextMenuTableInsertion
} from './editor-context-menu-actions';
import {
  GENERATED_CONTENT_READINESS_TIMEOUT_MS,
  editorBlockIndexFailureCode,
  editorBlockIndexFromData,
  generatedContentReadinessKey
} from './editor-context-menu-helpers';
import { createSourceContextMenuSurface } from './editor-context-menu-source-surface';
import { createVisualContextMenuSurface } from './editor-context-menu-visual-surface';
import type {
  ApplyVisualCanonicalChange,
  ContextMenuBlockIndexFailure,
  ContextMenuTableRequest,
  EditorRootProps,
  EditorStatus,
  GeneratedContentReadinessFailure,
  ImmersiveVisualEditorRuntime,
  PendingGeneratedContentPin,
  PendingImageTargetPin,
  SharedRef
} from './editor-root-types';

export type UseEditorContextMenuBridgeOptions = Readonly<{
  appearance: EditorRootProps['appearance'];
  applyVisualCanonicalChange: ApplyVisualCanonicalChange;
  contextMenuExecutorRef: SharedRef<((commandId: string) => void) | null>;
  contextMenuStrings: EditorRootProps['contextMenuStrings'];
  documentSession: EditorDocumentSession | null;
  editorBlockIndexPort: EditorRootProps['editorBlockIndexPort'];
  editorClipboardPort: EditorRootProps['editorClipboardPort'];
  editorImagePixelsPort: EditorRootProps['editorImagePixelsPort'];
  generatedContentExportSession: EditorRootProps['generatedContentExportSession'];
  getNextPreviewRevision: () => number;
  imageUpload: EditorRootProps['imageUpload'];
  immersiveEnvironment: EditorRootProps['immersiveEnvironment'];
  immersiveRef: SharedRef<boolean>;
  notifyContextMenuReadiness: () => void;
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
  previewRuntimeGeneration: number;
  previewRuntimeRef: SharedRef<PreviewSurfaceRuntime | null>;
  publishEditorStatus: (status: EditorStatus) => void;
  referenceLabelCaseFoldProfile: EditorRootProps['referenceLabelCaseFoldProfile'];
  releasePendingContextResourcesRef: SharedRef<
    (reason?: 'cancelled' | 'unavailable') => void
  >;
  remoteImageImportPort: RemoteImageImportPort;
  reportFailure: (code: string) => void;
  rootActiveRef: SharedRef<boolean>;
  simplifiedFormattingParser: EditorRootProps['simplifiedFormattingParser'];
  submissionField: HTMLTextAreaElement;
  subscribeContextMenuReadiness: (listener: () => void) => () => void;
  toolbar: EditorRootProps['toolbar'];
  visualEditorGeneration: number;
  visualEditorRuntimeRef: SharedRef<ImmersiveVisualEditorRuntime | null>;
  visualEditorSurface: HTMLElement | null;
  visualPreviewEditing: boolean;
}>;

export function useEditorContextMenuBridge({
  appearance,
  applyVisualCanonicalChange,
  contextMenuExecutorRef,
  contextMenuStrings,
  documentSession,
  editorBlockIndexPort,
  editorClipboardPort,
  editorImagePixelsPort,
  generatedContentExportSession,
  getNextPreviewRevision,
  imageUpload,
  immersiveEnvironment,
  immersiveRef,
  notifyContextMenuReadiness,
  openMediaPicker,
  prepareGeneratedSourceNavigation,
  preview,
  previewAppearanceRef,
  previewPort,
  previewRuntimeGeneration,
  previewRuntimeRef,
  publishEditorStatus,
  referenceLabelCaseFoldProfile,
  releasePendingContextResourcesRef,
  remoteImageImportPort,
  reportFailure,
  rootActiveRef,
  simplifiedFormattingParser,
  submissionField,
  subscribeContextMenuReadiness,
  toolbar,
  visualEditorGeneration,
  visualEditorRuntimeRef,
  visualEditorSurface,
  visualPreviewEditing
}: UseEditorContextMenuBridgeOptions) {
  const contextMenuPortalOwnerRef = useRef<HTMLElement | null>(null);
  const registerContextMenuPortalOwner = useCallback(
    (element: HTMLElement | null): void => {
      contextMenuPortalOwnerRef.current = element;
    },
    []
  );
  const isOwnedShortcutTarget = useCallback((target: Element): boolean => {
    const owner = contextMenuPortalOwnerRef.current;
    return Boolean(owner?.isConnected && owner.contains(target));
  }, []);

  const contextMenuActionCapabilitiesRef =
    useRef<EditorContextMenuActionCapabilities | null>(null);
  const contextMenuActionCoordinatorRef =
    useRef<EditorContextMenuActionCoordinator | null>(null);
  const editorCodeContentQueryRef =
    useRef<EditorCodeContentQuerySession | null>(null);
  const editorCodeContentQuerySequenceRef = useRef(0);
  const editorCodeContentFailureRef = useRef<string | null>(null);
  const editorCodeIndentationCandidateSequenceRef = useRef(0);
  const editorSourceLinkQueryRef =
    useRef<EditorSourceLinkQuerySession | null>(null);
  const editorSourceLinkQuerySequenceRef = useRef(0);
  const pendingGeneratedContentPinRef =
    useRef<PendingGeneratedContentPin | null>(null);
  const pendingImageTargetPinRef = useRef<PendingImageTargetPin | null>(null);
  const generatedContentReadinessFailureRef =
    useRef<GeneratedContentReadinessFailure | null>(null);
  const contextMenuBlockIndexCacheRef =
    useRef<EditorContextMenuBlockIndexCache | null>(null);
  const contextMenuBlockIndexFailureRef =
    useRef<ContextMenuBlockIndexFailure | null>(null);
  const applyVisualCanonicalChangeRef = useRef(applyVisualCanonicalChange);
  applyVisualCanonicalChangeRef.current = applyVisualCanonicalChange;

  if (!contextMenuBlockIndexCacheRef.current) {
    const cacheClock = createBrowserEditorImageHydrationScheduler(
      submissionField.ownerDocument,
      new AbortController().signal
    );
    contextMenuBlockIndexCacheRef.current =
      createEditorContextMenuBlockIndexCache({
        now: cacheClock.now
      });
  }

  const [contextMenuTableRequest, setContextMenuTableRequest] =
    useState<ContextMenuTableRequest | null>(null);

  const releasePendingGeneratedContentPin = useCallback(
    (preserveFailure = false) => {
      const pending = pendingGeneratedContentPinRef.current;
      pendingGeneratedContentPinRef.current = null;
      if (!preserveFailure) generatedContentReadinessFailureRef.current = null;
      pending?.readinessCancel?.();
      if (pending) {
        pending.readinessCancel = null;
      }
      pending?.pin.release();
    },
    []
  );

  const releasePendingImageTargetPin = useCallback(() => {
    const pending = pendingImageTargetPinRef.current;
    pendingImageTargetPinRef.current = null;
    pending?.pin.release();
  }, []);

  const releasePendingContextResources = useCallback(
    (reason?: 'cancelled' | 'unavailable') => {
      editorCodeContentQueryRef.current?.cancel();
      editorSourceLinkQueryRef.current?.cancel();
      releasePendingGeneratedContentPin(
        'cancelled' === reason || 'unavailable' === reason
      );
      releasePendingImageTargetPin();
    },
    [releasePendingGeneratedContentPin, releasePendingImageTargetPin]
  );
  releasePendingContextResourcesRef.current = releasePendingContextResources;

  const scheduleGeneratedContentReadiness = useCallback(
    (pending: PendingGeneratedContentPin): void => {
      const key = generatedContentReadinessKey(pending);
      const deadline =
        immersiveEnvironment.now() + GENERATED_CONTENT_READINESS_TIMEOUT_MS;
      const arm = (delay: number): void => {
        pending.readinessCancel = immersiveEnvironment.schedule(() => {
          if (
            !rootActiveRef.current
            || pendingGeneratedContentPinRef.current !== pending
          )
            return;
          const remaining = deadline - immersiveEnvironment.now();
          if (remaining > 0) {
            arm(remaining);
            return;
          }
          pendingGeneratedContentPinRef.current = null;
          pending.readinessCancel = null;
          pending.pin.release();
          generatedContentReadinessFailureRef.current = {
            code: 'editor-context-menu-generated-content-unavailable',
            key
          };
          notifyContextMenuReadiness();
        }, Math.max(0, delay));
      };
      arm(GENERATED_CONTENT_READINESS_TIMEOUT_MS);
    },
    [immersiveEnvironment, notifyContextMenuReadiness, rootActiveRef]
  );

  const readContextMenuCurrentContext = useCallback(
    (surface: EditorContextSnapshot['surface']) => {
      if (!documentSession) return null;
      const revision = documentSession.document.getRevision?.();
      return {
        ...(undefined === revision ? {} : { revision }),
        selection: documentSession.document.getSelection(),
        ...('source' === surface
          ? { surfaceIdentity: documentSession }
          : visualEditorRuntimeRef.current
            ? {
                surfaceGeneration: visualEditorGeneration,
                surfaceIdentity: visualEditorRuntimeRef.current
              }
            : {}),
        surface,
        value: documentSession.document.getValue()
      };
    },
    [documentSession, visualEditorGeneration, visualEditorRuntimeRef]
  );

  useEffect(
    () => () => generatedContentExportSession?.dispose(),
    [generatedContentExportSession]
  );

  useEffect(() => {
    const coordinator = contextMenuActionCoordinatorRef.current;
    if (!coordinator || !documentSession) return;
    coordinator.recheckOwner((captured) => {
      const current = readContextMenuCurrentContext(captured.surface);
      return Boolean(current && isEditorContextCurrent(captured, current));
    });
  }, [
    documentSession,
    readContextMenuCurrentContext,
    visualEditorGeneration,
    visualEditorSurface
  ]);

  const editorCodeContentQuery = useMemo(
    () =>
      createEditorCodeContentQuery({
        isCurrent: (binding: EditorCodeContentQueryBinding): boolean => {
          if (!documentSession) return false;
          if (binding.source !== documentSession.document.getValue())
            return false;
          if (
            !Object.is(
              binding.revision,
              documentSession.document.getRevision?.()
            )
          ) {
            return false;
          }
          const selection = documentSession.document.getSelection();
          if (
            selection.start !== binding.selection.start
            || selection.end !== binding.selection.end
            || selection.direction !== binding.selection.direction
          ) {
            return false;
          }
          if ('source' === binding.surface) {
            return (
              binding.generation === 0 && binding.menuIdentity === documentSession
            );
          }
          const runtime = visualEditorRuntimeRef.current;
          return (
            binding.generation === visualEditorGeneration
            && binding.menuIdentity === runtime
          );
        },
        notify: notifyContextMenuReadiness,
        onUnavailable: (binding, code) => {
          if ('editor-code-content-map-unavailable' === code) return;
          const key = [
            binding.surface,
            binding.generation,
            binding.revision ?? '',
            binding.selection.start,
            binding.selection.end,
            binding.source.length,
            code
          ].join(':');
          if (editorCodeContentFailureRef.current === key) return;
          editorCodeContentFailureRef.current = key;
          reportFailure(code);
        },
        previewPort,
        requestFactory: ({ binding, markdown, target }) => {
          const defaultArticleTheme = appearance.articleThemes.find(
            ({ id }) => 'default' === id
          );
          if (
            !defaultArticleTheme
            || !appearance.codeThemes.some(
              ({ id }) => id === defaultArticleTheme.defaultCodeTheme
            )
          ) {
            throw new Error('editor-code-content-default-profile-unavailable');
          }
          return {
            codeTheme: defaultArticleTheme.defaultCodeTheme,
            customCssId: '',
            markdown,
            markdownTheme: defaultArticleTheme.id,
            postId: preview.postId,
            signature:
              `editor-code-content:${++editorCodeContentQuerySequenceRef.current}`
              + `:${binding.surface}:${target.kind}:${target.ownerLineStart}`
              + `:${target.ownerLineEnd}:${markdown.length}`
          };
        }
      }),
    [
      appearance.articleThemes,
      appearance.codeThemes,
      documentSession,
      notifyContextMenuReadiness,
      preview.postId,
      previewPort,
      reportFailure,
      visualEditorGeneration,
      visualEditorRuntimeRef
    ]
  );

  useEffect(() => {
    editorCodeContentQueryRef.current = editorCodeContentQuery;
    return () => {
      if (editorCodeContentQueryRef.current === editorCodeContentQuery) {
        editorCodeContentQueryRef.current = null;
      }
      editorCodeContentQuery.dispose();
    };
  }, [editorCodeContentQuery]);

  const editorSourceLinkQuery = useMemo<EditorSourceLinkQuerySession | null>(
    () => {
      if (!simplifiedFormattingParser) return null;
      return createEditorSourceLinkQuery({
        isCurrent: (binding: EditorSourceLinkQueryBinding): boolean => {
          if (!documentSession) return false;
          if (binding.menuIdentity !== documentSession) return false;
          if (binding.source !== documentSession.document.getValue()) {
            return false;
          }
          if (
            !Object.is(
              binding.revision,
              documentSession.document.getRevision?.()
            )
          ) {
            return false;
          }
          const selection = documentSession.document.getSelection();
          return (
            selection.start === binding.selection.start
            && selection.end === binding.selection.end
            && selection.direction === binding.selection.direction
          );
        },
        notify: notifyContextMenuReadiness,
        parser: simplifiedFormattingParser,
        previewPort,
        requestFactory: ({ binding, candidate, markdown }) => {
          const defaultArticleTheme = appearance.articleThemes.find(
            ({ id }) => 'default' === id
          );
          if (
            !defaultArticleTheme
            || !appearance.codeThemes.some(
              ({ id }) => id === defaultArticleTheme.defaultCodeTheme
            )
          ) {
            throw new Error('editor-source-link-default-profile-unavailable');
          }
          return {
            codeTheme: defaultArticleTheme.defaultCodeTheme,
            customCssId: '',
            markdown,
            markdownTheme: defaultArticleTheme.id,
            postId: preview.postId,
            signature:
              `editor-source-link:${++editorSourceLinkQuerySequenceRef.current}`
              + `:${binding.revision ?? 'none'}:${candidate.kind}`
              + `:${candidate.from}:${candidate.to}:${markdown.length}`
          };
        }
      });
    },
    [
      appearance.articleThemes,
      appearance.codeThemes,
      documentSession,
      notifyContextMenuReadiness,
      preview.postId,
      previewPort,
      simplifiedFormattingParser
    ]
  );

  useEffect(() => {
    editorSourceLinkQueryRef.current = editorSourceLinkQuery;
    return () => {
      if (editorSourceLinkQueryRef.current === editorSourceLinkQuery) {
        editorSourceLinkQueryRef.current = null;
      }
      editorSourceLinkQuery?.dispose();
    };
  }, [editorSourceLinkQuery]);

  const reportContextMenuFailure = useCallback(
    (code: string, message?: string) => {
      reportFailure(code);
      if (message) {
        publishEditorStatus({
          id: `context-menu-${code}`,
          message,
          owner: 'editor',
          type: 'error'
        });
      }
    },
    [publishEditorStatus, reportFailure]
  );

  contextMenuActionCapabilitiesRef.current =
    createContextMenuActionCapabilities({
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
      referenceLabelCaseFoldProfile,
      remoteImageImportPort,
      reportContextMenuFailure,
      rootActiveRef,
      setContextMenuTableRequest,
      simplifiedFormattingParser,
      toolbar,
      visualEditorGeneration,
      visualEditorRuntimeRef
    });

  const contextMenuActionCoordinator = useMemo(
    () =>
      createEditorContextMenuActionCoordinator({
        getCapabilities: () => {
          const capabilities = contextMenuActionCapabilitiesRef.current;
          if (!capabilities) {
            throw new Error('editor-context-menu-capabilities-unavailable');
          }
          return capabilities;
        }
      }),
    []
  );
  contextMenuActionCoordinatorRef.current = contextMenuActionCoordinator;

  useEffect(
    () => () => {
      contextMenuActionCoordinatorRef.current?.dispose();
    },
    []
  );

  const insertContextMenuTable = useCallback(
    (rows: number, columns: number): void => {
      executeContextMenuTableInsertion({
        applyVisualCanonicalChange,
        columns,
        contextMenuBlockIndexCacheRef,
        contextMenuStrings,
        documentSession,
        editorBlockIndexPort,
        reportContextMenuFailure,
        request: contextMenuTableRequest,
        rows,
        setContextMenuTableRequest,
        visualEditorGeneration,
        visualEditorRuntimeRef
      });
    },
    [
      applyVisualCanonicalChange,
      contextMenuStrings,
      contextMenuTableRequest,
      documentSession,
      editorBlockIndexPort,
      reportContextMenuFailure,
      visualEditorGeneration,
      visualEditorRuntimeRef
    ]
  );

  const contextMenuBlockIndexCache = contextMenuBlockIndexCacheRef.current;
  if (!contextMenuBlockIndexCache) {
    throw new Error('editor-context-menu-block-index-cache-unavailable');
  }

  const requestContextMenuBlockIndex = useCallback(
    (
      owner: object,
      generation: number,
      revision: number,
      source: string
    ): EditorMarkdownBlockIndex | null => {
      const cached = contextMenuBlockIndexCache.peek({
        generation,
        owner,
        revision
      });
      if (cached?.source === source) {
        contextMenuBlockIndexFailureRef.current = null;
        return cached;
      }
      if (cached && cached.source !== source)
        contextMenuBlockIndexCache.invalidate(owner);
      const port = editorBlockIndexPort;
      const session = documentSession;
      if (!port || !session) return null;
      const scheduled = contextMenuBlockIndexCache.schedule({
        build: async (signal, { deadline }) => {
          const scheduler = createBrowserEditorImageHydrationScheduler(
            session.document.getInputElement().ownerDocument,
            signal
          );
          return editorBlockIndexFromData(
            source,
            await port.build({ generation, revision, source }, signal),
            revision,
            signal,
            deadline,
            scheduler
          );
        },
        delayMs: 0,
        generation,
        onFailure: (error) => {
          const code = editorBlockIndexFailureCode(error);
          contextMenuBlockIndexFailureRef.current = {
            code,
            generation,
            owner,
            revision,
            source
          };
          reportFailure(code);
          notifyContextMenuReadiness();
        },
        owner,
        revision,
        timeoutMs: 10_000
      });
      if (scheduled) contextMenuBlockIndexFailureRef.current = null;
      return null;
    },
    [
      contextMenuBlockIndexCache,
      documentSession,
      editorBlockIndexPort,
      notifyContextMenuReadiness,
      reportFailure
    ]
  );

  const subscribeContextMenuBlockIndex = useCallback(
    (listener: () => void): (() => void) =>
      contextMenuBlockIndexCache.subscribe(listener),
    [contextMenuBlockIndexCache]
  );

  useEffect(
    () => () => {
      contextMenuBlockIndexCache.dispose();
      releasePendingContextResources();
    },
    [contextMenuBlockIndexCache, releasePendingContextResources]
  );

  useEffect(() => {
    if (!documentSession) return undefined;
    return documentSession.document.subscribe(() => {
      contextMenuBlockIndexFailureRef.current = null;
      contextMenuBlockIndexCache.invalidate(documentSession);
      editorCodeContentQueryRef.current?.cancel();
      editorSourceLinkQueryRef.current?.cancel();
      const runtime = visualEditorRuntimeRef.current;
      if (runtime) contextMenuBlockIndexCache.invalidate(runtime);
    });
  }, [contextMenuBlockIndexCache, documentSession, visualEditorRuntimeRef]);

  const contextMenuHeading = useMemo(
    () => ({
      commands: toolbar.commands,
      label: toolbar.headingLevelLabel
    }),
    [toolbar.commands, toolbar.headingLevelLabel]
  );

  const contextMenuSource = useMemo<EditorContextMenuSurface | null>(() => {
    void previewRuntimeGeneration;
    if (!documentSession) return null;
    return createSourceContextMenuSurface({
      contextMenuBlockIndexFailureRef,
      documentSession,
      editorClipboardPort,
      editorCodeContentQuery,
      editorImagePixelsPort,
      editorSourceLinkQuery,
      generatedContentReadinessFailureRef,
      hasBlockIndexPort: Boolean(editorBlockIndexPort),
      hasGeneratedContentExport: Boolean(generatedContentExportSession),
      imageUpload,
      immersiveRef,
      pendingGeneratedContentPinRef,
      pendingImageTargetPinRef,
      previewRuntimeRef,
      releasePendingContextResources,
      releasePendingGeneratedContentPin,
      releasePendingImageTargetPin,
      requestContextMenuBlockIndex,
      scheduleGeneratedContentReadiness,
      subscribeContextMenuBlockIndex,
      subscribeContextMenuReadiness
    });
  }, [
    documentSession,
    editorBlockIndexPort,
    editorClipboardPort,
    editorCodeContentQuery,
    editorImagePixelsPort,
    editorSourceLinkQuery,
    generatedContentExportSession,
    imageUpload,
    immersiveRef,
    previewRuntimeGeneration,
    previewRuntimeRef,
    releasePendingContextResources,
    releasePendingGeneratedContentPin,
    releasePendingImageTargetPin,
    requestContextMenuBlockIndex,
    scheduleGeneratedContentReadiness,
    subscribeContextMenuBlockIndex,
    subscribeContextMenuReadiness
  ]);

  const contextMenuVisual = useMemo<EditorContextMenuSurface | null>(() => {
    void previewRuntimeGeneration;
    if (!documentSession || !visualPreviewEditing || !visualEditorSurface)
      return null;
    const runtime = visualEditorRuntimeRef.current;
    if (!runtime) return null;
    return createVisualContextMenuSurface({
      contextMenuBlockIndexFailureRef,
      documentSession,
      editorClipboardPort,
      editorCodeContentQuery,
      editorImagePixelsPort,
      hasBlockIndexPort: Boolean(editorBlockIndexPort),
      hasGeneratedContentExport: Boolean(generatedContentExportSession),
      imageUpload,
      pendingImageTargetPinRef,
      previewRuntimeRef,
      releasePendingImageTargetPin,
      requestContextMenuBlockIndex,
      runtime,
      subscribeContextMenuBlockIndex,
      subscribeContextMenuReadiness,
      visualEditorGeneration,
      visualEditorSurface
    });
  }, [
    documentSession,
    editorBlockIndexPort,
    editorClipboardPort,
    editorCodeContentQuery,
    editorImagePixelsPort,
    generatedContentExportSession,
    imageUpload,
    previewRuntimeGeneration,
    previewRuntimeRef,
    releasePendingImageTargetPin,
    requestContextMenuBlockIndex,
    subscribeContextMenuBlockIndex,
    subscribeContextMenuReadiness,
    visualEditorGeneration,
    visualEditorRuntimeRef,
    visualEditorSurface,
    visualPreviewEditing
  ]);

  return {
    closeContextMenuTableDialog: () => setContextMenuTableRequest(null),
    contextMenuActionCoordinator,
    contextMenuHeading,
    contextMenuSource,
    contextMenuTableRequest,
    contextMenuVisual,
    insertContextMenuTable,
    isOwnedShortcutTarget,
    registerContextMenuPortalOwner,
    reportContextMenuFailure
  };
}
