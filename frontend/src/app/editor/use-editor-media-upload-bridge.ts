import {
  flushSync,
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
  type WechatExportStatus,
  createWechatExportSession
} from '../../features/wechat-export/wechat-export-session';
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
  applyVisualCanonicalChange: ApplyVisualCanonicalChange;
  documentSession: EditorDocumentSession | null;
  executeExternalCommand: EditorRootProps['executeExternalCommand'];
  imageUpload: EditorRootProps['imageUpload'];
  imageUploadPort: ImageUploadPort;
  immersiveStrings: EditorRootProps['immersiveStrings'];
  leaveVisualPreview: (
    options?: Readonly<{ suppressRefresh?: boolean }>
  ) => boolean;
  mediaPicker: EditorRootProps['mediaPicker'];
  mediaPickerFailureMessage: string;
  mediaPickerFrame: EditorRootProps['mediaPickerFrame'];
  prepareVisualSource: () => boolean;
  previewRuntimeGeneration: number;
  previewRuntimeRef: SharedRef<PreviewSurfaceRuntime | null>;
  protectedOperationError: (operation: EditorSessionOperation) => Error | null;
  publishEditorStatus: (status: EditorStatus) => void;
  remoteImageImportPort: RemoteImageImportPort;
  reportFailure: (code: string) => void;
  rootActiveRef: SharedRef<boolean>;
  toolbar: EditorRootProps['toolbar'];
  visualEditorRuntimeRef: SharedRef<ImmersiveVisualEditorRuntime | null>;
  visualEditorSurface: HTMLElement | null;
  visualPreviewEditing: boolean;
  visualPreviewEditingRef: SharedRef<boolean>;
  waitForFreshFormalPreview: () => Promise<HTMLElement | null>;
  wechatClipboard: EditorRootProps['wechatClipboard'];
  wechatExport: EditorRootProps['wechatExport'];
  wechatVisualRasterizationPort: EditorRootProps['wechatVisualRasterizationPort'];
}>;

export function useEditorMediaUploadBridge({
  applyVisualCanonicalChange,
  documentSession,
  executeExternalCommand,
  imageUpload,
  imageUploadPort: rawImageUploadPort,
  immersiveStrings,
  leaveVisualPreview,
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
  toolbar,
  visualEditorRuntimeRef,
  visualEditorSurface,
  visualPreviewEditing,
  visualPreviewEditingRef,
  waitForFreshFormalPreview,
  wechatClipboard,
  wechatExport,
  wechatVisualRasterizationPort
}: UseEditorMediaUploadBridgeOptions) {
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
      resolvePreview: async () => {
        if (visualPreviewEditingRef.current) {
          if (!prepareVisualSource()) return null;
          flushSync(() => {
            leaveVisualPreview({ suppressRefresh: true });
          });
          return waitForFreshFormalPreview();
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
    leaveVisualPreview,
    prepareVisualSource,
    previewRuntimeRef,
    reportFailure,
    setWechatStatus,
    visualPreviewEditingRef,
    waitForFreshFormalPreview,
    wechatClipboard,
    wechatExport,
    wechatVisualRasterizationPort
  ]);

  const copyWechatFromImmersive = useCallback(async () => {
    return 'copied' === (await wechatSession.copy()).status;
  }, [wechatSession]);

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
        void wechatSession.copy();
        return true;
      }
      return executeExternalCommand(commandId, session);
    },
    [
      applyVisualCanonicalChange,
      documentSession,
      executeExternalCommand,
      openMediaPicker,
      rootActiveRef,
      toolbar.commands,
      visualEditorRuntimeRef,
      visualPreviewEditingRef,
      wechatSession
    ]
  );

  useEffect(
    () => () => {
      mediaPickerFrame?.cancel?.();
    },
    [mediaPickerFrame]
  );

  useEffect(() => () => wechatSession.dispose(), [wechatSession]);

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
