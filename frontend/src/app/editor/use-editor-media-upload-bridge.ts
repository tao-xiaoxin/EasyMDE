import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from '@wordpress/element';

import type { EditorSessionOperation } from '../../contracts/ports/editor-session-port';
import type { ImageUploadPort } from '../../contracts/ports/image-upload-port';
import type { MediaPickerDocumentPort } from '../../contracts/ports/media-picker-port';
import type { NativeFeaturedImage } from '../../contracts/ports/native-publish-port';
import type { RemoteImageImportPort } from '../../contracts/ports/remote-image-import-port';
import type { WechatClipboardCopyOptions } from '../../contracts/ports/wechat-clipboard-port';
import type { EditorDocumentSession } from '../../features/document-source/ui/EditorDocumentSource';
import {
  type ImageUploadSessionController,
  type ImageUploadStatus,
  createImageUploadSessionController,
  createRemoteImageImportCoordinator
} from '../../features/image-upload/image-upload-session';
import { openFeaturedImagePicker } from '../../features/immersive-editor/open-featured-image-picker';
import type { PreviewSurfaceRuntime } from '../../features/live-preview/ui/PreviewSurfaceOwner';
import { openMediaPickerSession } from '../../features/media-picker/media-picker-session';
import {
  type WechatExportSession,
  type WechatExportStatus,
  createWechatExportSession
} from '../../features/wechat-export/wechat-export-session';
import type { WechatCopyStatusStore } from '../../features/wechat-export/wechat-copy-status';
import {
  documentPort,
  mediaPickerFailureCode,
  visualMediaPickerDocument
} from './editor-root-helpers';
import type {
  ApplyVisualCanonicalChange,
  EditorRootProps,
  EditorStatus,
  ImmersiveVisualEditorRuntime,
  SharedRef,
  VisualCanonicalChangeContext
} from './editor-root-types';

export type UseEditorMediaUploadBridgeOptions = Readonly<{
  appearanceTransitionPendingRef: SharedRef<number | null>;
  applyVisualCanonicalChange: ApplyVisualCanonicalChange;
  documentSession: EditorDocumentSession | null;
  executeExternalCommand: EditorRootProps['executeExternalCommand'];
  imageUpload: EditorRootProps['imageUpload'];
  imageUploadPort: ImageUploadPort;
  immersiveStrings: EditorRootProps['immersiveStrings'];
  mediaPicker: EditorRootProps['mediaPicker'];
  mediaPickerFailureMessage: string;
  mediaPickerFrame: EditorRootProps['mediaPickerFrame'];
  prepareVisualSource: () => boolean;
  previewRuntimeGeneration: number;
  previewRuntimeRef: SharedRef<PreviewSurfaceRuntime | null>;
  protectedOperationError: (operation: EditorSessionOperation) => Error | null;
  publishEditorStatus: (status: EditorStatus) => void;
  remoteImageImportPort: RemoteImageImportPort;
  reportFailure: (code: string, level?: 'error' | 'info') => void;
  rootActiveRef: SharedRef<boolean>;
  scheduleCurrentWechatPreviewPreparation: () => void;
  toolbar: EditorRootProps['toolbar'];
  visualEditorRuntimeRef: SharedRef<ImmersiveVisualEditorRuntime | null>;
  visualEditorSurface: HTMLElement | null;
  visualPreviewEditing: boolean;
  visualPreviewEditingRef: SharedRef<boolean>;
  waitForFreshFormalPreview: (signal?: AbortSignal) => Promise<HTMLElement | null>;
  wechatClipboard: EditorRootProps['wechatClipboard'];
  wechatCopyPendingRef: SharedRef<boolean>;
  wechatCopySequenceRef: SharedRef<number>;
  wechatCopyStatus: WechatCopyStatusStore;
  wechatExport: EditorRootProps['wechatExport'];
  wechatSessionRef: SharedRef<WechatExportSession | null>;
  wechatVisualRasterizationPort: EditorRootProps['wechatVisualRasterizationPort'];
}>;

export function useEditorMediaUploadBridge({
  appearanceTransitionPendingRef,
  applyVisualCanonicalChange,
  documentSession,
  executeExternalCommand,
  imageUpload,
  imageUploadPort: rawImageUploadPort,
  immersiveStrings,
  mediaPicker,
  mediaPickerFailureMessage,
  mediaPickerFrame,
  prepareVisualSource,
  previewRuntimeGeneration,
  previewRuntimeRef,
  protectedOperationError,
  publishEditorStatus,
  remoteImageImportPort: rawRemoteImageImportPort,
  reportFailure,
  rootActiveRef,
  scheduleCurrentWechatPreviewPreparation,
  toolbar,
  visualEditorRuntimeRef,
  visualEditorSurface,
  visualPreviewEditing,
  visualPreviewEditingRef,
  waitForFreshFormalPreview,
  wechatClipboard,
  wechatCopyPendingRef,
  wechatCopySequenceRef,
  wechatCopyStatus,
  wechatExport,
  wechatSessionRef,
  wechatVisualRasterizationPort
}: UseEditorMediaUploadBridgeOptions) {
  const scheduleWechatPreparationAfterCopyRef = useRef<(() => void) | null>(
    null
  );
  scheduleWechatPreparationAfterCopyRef.current =
    scheduleCurrentWechatPreviewPreparation;
  const mediaOperationRef = useRef<Promise<unknown> | null>(null);
  const featuredImageOperationRef =
    useRef<Promise<NativeFeaturedImage | null> | null>(null);
  const imageUploadControllerRef = useRef<ImageUploadSessionController | null>(
    null
  );
  const imageUploadOperationSequenceRef = useRef(0);
  const [mediaPickerDialog, setMediaPickerDialog] = useState<
    'media' | 'featured' | null
  >(null);

  const setImageUploadStatus = useCallback(
    (status: ImageUploadStatus) => {
      publishEditorStatus({
        ...status,
        id: status.operationId,
        owner: 'editor'
      });
    },
    [publishEditorStatus]
  );

  const nextImageUploadOperationId = useCallback(
    () => `image-upload-${++imageUploadOperationSequenceRef.current}`,
    []
  );

  const setWechatStatus = useCallback(
    (status: WechatExportStatus) => {
      publishEditorStatus({
        ...status,
        id: 'wechat-export',
        owner: 'editor'
      });
    },
    [publishEditorStatus]
  );

  const closeMediaPickerDialog = useCallback(() => {
    mediaPickerFrame?.cancel?.();
    setMediaPickerDialog(null);
  }, [mediaPickerFrame]);

  const handleMediaPickerAttachError = useCallback(
    (error: unknown) => {
      mediaPickerFrame?.cancel?.();
      setMediaPickerDialog(null);
      if (!rootActiveRef.current) return;
      reportFailure(mediaPickerFailureCode(error));
      publishEditorStatus({
        id: 'media-picker',
        message: mediaPickerFailureMessage,
        owner: 'editor',
        type: 'error'
      });
    },
    [
      mediaPickerFailureMessage,
      mediaPickerFrame,
      publishEditorStatus,
      reportFailure,
      rootActiveRef
    ]
  );

  const openMediaPicker = useCallback(
    (
      session: EditorDocumentSession,
      pickerDocument?: MediaPickerDocumentPort
    ) => {
      if (mediaOperationRef.current) {
        return mediaOperationRef.current;
      }
      const sessionError = protectedOperationError('authenticated');
      const frame = mediaPickerFrame;
      const frameAvailable = Boolean(frame?.attachFrame && frame.frameUrl);
      const operation = sessionError
        ? Promise.reject(sessionError)
        : !frameAvailable
          ? Promise.reject(new Error('media-picker-unavailable'))
          : openMediaPickerSession({
              document:
                pickerDocument
                ?? documentPort(session, () => rootActiveRef.current),
              frame,
              strings: mediaPicker
            });
      mediaOperationRef.current = operation;
      if (!sessionError && frameAvailable) {
        setMediaPickerDialog('media');
      }
      void operation
        .catch((error: unknown) => {
          if (!rootActiveRef.current) {
            return;
          }
          reportFailure(mediaPickerFailureCode(error));
          publishEditorStatus({
            id: 'media-picker',
            message: mediaPickerFailureMessage,
            owner: 'editor',
            type: 'error'
          });
        })
        .finally(() => {
          if (mediaOperationRef.current === operation) {
            mediaOperationRef.current = null;
          }
          setMediaPickerDialog(null);
        });
      return operation;
    },
    [
      mediaPicker,
      mediaPickerFailureMessage,
      mediaPickerFrame,
      protectedOperationError,
      publishEditorStatus,
      reportFailure,
      rootActiveRef
    ]
  );

  const imageUploadPort = useMemo<ImageUploadPort>(
    () => ({
      upload: (request) => {
        const sessionError = protectedOperationError('post-write');
        return sessionError
          ? Promise.resolve({ code: sessionError.message, status: 'failed' })
          : rawImageUploadPort.upload(request);
      }
    }),
    [protectedOperationError, rawImageUploadPort]
  );

  const wechatSession = useMemo(() => {
    const copyOptions: WechatClipboardCopyOptions = {
      ...(wechatVisualRasterizationPort
        ? { visualRasterizationPort: wechatVisualRasterizationPort }
        : {}),
      imageUploadPort,
      maxBytes: imageUpload.maxBytes,
      pngConversionEnabled: wechatExport.pngConversionEnabled,
      postId: imageUpload.postId,
      resolvePreview: async (signal?: AbortSignal) => {
        if (visualPreviewEditingRef.current) {
          // Settle pending visual edits (including an active IME composition)
          // first, then flush the visual source and refresh the hidden
          // read-only formal Preview in place. Visual editing stays unlocked
          // throughout, so a failed formal render reports an explicit Copy
          // failure instead of locking the user out of the document.
          const settled = await (
            visualEditorRuntimeRef.current?.settlePendingEdits?.()
            ?? Promise.resolve(true)
          );
          if (!settled || signal?.aborted || !prepareVisualSource()) return null;
          return waitForFreshFormalPreview(signal);
        }
        return previewRuntimeRef.current?.surface ?? null;
      }
    };
    return createWechatExportSession({
      clipboard: wechatClipboard,
      copyOptions,
      enabled: wechatExport.enabled,
      getPreview: () => previewRuntimeRef.current?.surface ?? null,
      onDiagnostic: reportFailure,
      onStatus: setWechatStatus,
      strings: wechatExport.strings
    });
  }, [
    imageUpload.maxBytes,
    imageUpload.postId,
    imageUploadPort,
    prepareVisualSource,
    previewRuntimeRef,
    reportFailure,
    setWechatStatus,
    visualEditorRuntimeRef,
    visualPreviewEditingRef,
    waitForFreshFormalPreview,
    wechatClipboard,
    wechatExport,
    wechatVisualRasterizationPort
  ]);

  wechatSessionRef.current = wechatSession;

  const requestWechatCopy = useCallback(() => {
    if (
      !rootActiveRef.current
      || wechatCopyPendingRef.current
      || null !== appearanceTransitionPendingRef.current
    ) {
      return Promise.resolve(false);
    }
    const sequence = ++wechatCopySequenceRef.current;
    wechatCopyPendingRef.current = true;
    let operation: ReturnType<typeof wechatSession.copy>;
    try {
      // Keep the session call in the originating click/key activation task. The
      // Clipboard adapter owns the activation-sensitive browser write.
      operation = wechatSession.copy();
      wechatCopyStatus.setPending(true);
    } catch (error) {
      if (wechatCopySequenceRef.current === sequence) {
        wechatCopyPendingRef.current = false;
      }
      throw error;
    }
    return operation
      .then(
        (result) =>
          rootActiveRef.current
          && wechatCopySequenceRef.current === sequence
          && 'copied' === result.status
      )
      .finally(() => {
        if (
          rootActiveRef.current
          && wechatCopySequenceRef.current === sequence
        ) {
          wechatCopyPendingRef.current = false;
          wechatCopyStatus.setPending(false);
          scheduleWechatPreparationAfterCopyRef.current?.();
        }
      });
  }, [
    appearanceTransitionPendingRef,
    rootActiveRef,
    wechatCopyPendingRef,
    wechatCopySequenceRef,
    wechatCopyStatus,
    wechatSession
  ]);

  const copyWechatFromImmersive = useCallback(
    () => requestWechatCopy(),
    [requestWechatCopy]
  );

  const remoteImageImportPort = useMemo<RemoteImageImportPort>(
    () => ({
      import: (request) => {
        const sessionError = protectedOperationError('post-write');
        return sessionError
          ? Promise.resolve({ code: sessionError.message, status: 'failed' })
          : rawRemoteImageImportPort.import(request);
      }
    }),
    [protectedOperationError, rawRemoteImageImportPort]
  );

  const remoteImageImportCoordinator = useMemo(() => {
    if (!documentSession) return null;
    return createRemoteImageImportCoordinator({
      document: documentPort(documentSession, () => rootActiveRef.current),
      insertion: imageUpload.insertion,
      onDiagnostic: reportFailure,
      postId: imageUpload.postId,
      remoteImageImport: remoteImageImportPort
    });
  }, [
    documentSession,
    imageUpload.insertion,
    imageUpload.postId,
    remoteImageImportPort,
    reportFailure,
    rootActiveRef
  ]);

  useEffect(
    () => () => remoteImageImportCoordinator?.destroy(),
    [remoteImageImportCoordinator]
  );

  const selectFeaturedImage = useCallback(() => {
    if (featuredImageOperationRef.current) {
      return featuredImageOperationRef.current;
    }
    const sessionError = protectedOperationError('authenticated');
    const frame = mediaPickerFrame;
    const frameAvailable = Boolean(frame?.attachFrame && frame.frameUrl);
    const operation = sessionError
      ? Promise.reject(sessionError)
      : !frameAvailable
        ? Promise.reject(new Error('featured-image-picker-unavailable'))
        : openFeaturedImagePicker(
            frame,
            immersiveStrings.selectFeaturedImage
          );
    if (!sessionError && frameAvailable) {
      setMediaPickerDialog('featured');
    }
    const reported = operation.catch((error: unknown) => {
      reportFailure(
        error instanceof Error
          && /^featured-image-[a-z0-9-]+$/.test(error.message)
          ? error.message
          : 'featured-image-picker-failed'
      );
      return null;
    });
    featuredImageOperationRef.current = reported;
    void reported.finally(() => {
      if (featuredImageOperationRef.current === reported) {
        featuredImageOperationRef.current = null;
      }
      setMediaPickerDialog(null);
    });
    return reported;
  }, [
    immersiveStrings.selectFeaturedImage,
    mediaPickerFrame,
    protectedOperationError,
    reportFailure
  ]);

  const executeRootExternalCommand = useCallback(
    (commandId: string, session: EditorDocumentSession) => {
      if (
        'image'
        === toolbar.commands.find((command) => command.id === commandId)?.action
      ) {
        const runtime = visualPreviewEditingRef.current
          ? visualEditorRuntimeRef.current
          : null;
        const revision = session.document.getRevision?.();
        const visualContext: VisualCanonicalChangeContext | null =
          runtime && documentSession === session
            ? {
                ...(undefined === revision ? {} : { revision }),
                selection: session.document.getSelection(),
                surface: 'visual',
                value: session.document.getValue()
              }
            : null;
        const pickerDocument = visualContext
          ? visualMediaPickerDocument(
              session,
              visualContext,
              () => rootActiveRef.current,
              () => runtime?.surface.focus(),
              applyVisualCanonicalChange
            )
          : undefined;
        void openMediaPicker(session, pickerDocument);
        return true;
      }
      if (
        'copyWechat'
        === toolbar.commands.find((command) => command.id === commandId)?.action
      ) {
        void requestWechatCopy();
        return true;
      }
      return executeExternalCommand(commandId, session);
    },
    [
      applyVisualCanonicalChange,
      documentSession,
      executeExternalCommand,
      openMediaPicker,
      requestWechatCopy,
      rootActiveRef,
      toolbar.commands,
      visualEditorRuntimeRef,
      visualPreviewEditingRef
    ]
  );

  useEffect(
    () => () => {
      mediaPickerFrame?.cancel?.();
    },
    [mediaPickerFrame]
  );

  useEffect(
    () => () => {
      wechatCopySequenceRef.current += 1;
      wechatCopyPendingRef.current = false;
      wechatCopyStatus.setPending(false);
      if (wechatSessionRef.current === wechatSession) {
        wechatSessionRef.current = null;
      }
      wechatSession.dispose();
    },
    [
      wechatCopyPendingRef,
      wechatCopySequenceRef,
      wechatCopyStatus,
      wechatSession,
      wechatSessionRef
    ]
  );

  const handleVisualImagePasteFiles = useCallback(
    (files: ReadonlyArray<File>, event: ClipboardEvent) => {
      imageUploadControllerRef.current?.uploadFiles(files, 'paste', event);
    },
    []
  );

  const handleVisualImageDropFiles = useCallback(
    (files: ReadonlyArray<File>, event: DragEvent) => {
      imageUploadControllerRef.current?.uploadFiles(files, 'drop', event);
    },
    []
  );

  useEffect(() => {
    void previewRuntimeGeneration;
    if (!documentSession || !remoteImageImportCoordinator) {
      return;
    }
    const canonicalDocument = documentPort(
      documentSession,
      () => rootActiveRef.current
    );
    if (visualPreviewEditing && !visualEditorSurface) {
      return;
    }
    const visualRuntime = visualPreviewEditing
      ? visualEditorRuntimeRef.current
      : null;
    const controller = createImageUploadSessionController({
      allowedExtensions: imageUpload.allowedExtensions,
      allowedMimeTypes: imageUpload.allowedMimeTypes,
      autoUploadPastedImages: imageUpload.autoUploadPastedImages,
      delegateLocalFileEvents: Boolean(visualRuntime),
      document: visualRuntime
        ? {
            applyTextChange: (change) => {
              canonicalDocument.applyTextChange(change);
            },
            focus: () => {
              if (visualRuntime.surface.isConnected) {
                visualRuntime.surface.focus({ preventScroll: true });
              } else {
                canonicalDocument.focus();
              }
            },
            getSnapshot: () => {
              if (!visualRuntime.prepareMediaSelection()) {
                throw new Error('visual-editor-selection-map-failed');
              }
              return canonicalDocument.getSnapshot();
            }
          }
        : canonicalDocument,
      enabled: imageUpload.enabled,
      insertion: imageUpload.insertion,
      maxBytes: imageUpload.maxBytes,
      nextOperationId: nextImageUploadOperationId,
      onDiagnostic: reportFailure,
      onStatus: setImageUploadStatus,
      postId: imageUpload.postId,
      remoteImageImportCoordinator,
      remoteImageUploadMode: imageUpload.remoteImageUploadMode,
      surface: visualRuntime ? 'visual' : 'source',
      strings: imageUpload.strings,
      target: visualEditorSurface ?? documentSession.document.getInputElement(),
      upload: imageUploadPort
    });
    imageUploadControllerRef.current = controller;
    return () => {
      if (imageUploadControllerRef.current === controller) {
        imageUploadControllerRef.current = null;
      }
      controller.dispose();
    };
  }, [
    documentSession,
    imageUpload,
    imageUploadPort,
    nextImageUploadOperationId,
    previewRuntimeGeneration,
    remoteImageImportCoordinator,
    reportFailure,
    rootActiveRef,
    setImageUploadStatus,
    visualEditorRuntimeRef,
    visualEditorSurface,
    visualPreviewEditing
  ]);

  return {
    closeMediaPickerDialog,
    copyWechatFromImmersive,
    executeRootExternalCommand,
    handleMediaPickerAttachError,
    handleVisualImageDropFiles,
    handleVisualImagePasteFiles,
    mediaPickerDialog,
    openMediaPicker,
    remoteImageImportPort,
    selectFeaturedImage
  };
}
