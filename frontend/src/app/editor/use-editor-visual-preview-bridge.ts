import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from '@wordpress/element';

import type { AppearanceState } from '../../contracts/bootstrap/appearance-bootstrap';
import type {
  PreviewEditMap,
  SafePreviewHtml
} from '../../contracts/ports/preview-request';
import type { EditorDocumentSession } from '../../features/document-source/ui/EditorDocumentSource';
import type { ImmersiveViewMode } from '../../features/immersive-editor/immersive-editor';
import type {
  PreviewSurfaceRuntime,
  PreviewSurfaceStatus
} from '../../features/live-preview/ui/PreviewSurfaceOwner';
import type { EditorToolbarSession } from '../../features/toolbar/ui/EditorToolbar';
import {
  immersiveModeFromEditingMode,
  previewRequest
} from './editor-root-helpers';
import type {
  CodeThemePreparation,
  EditorRootProps,
  EditorStatus,
  EditorStatusState,
  EditorVisualPreviewSnapshot,
  ImmersiveVisualEditorRuntime,
  LayoutScrollRestoreEntry,
  SharedRef
} from './editor-root-types';
import { useEditorImmersiveMode } from './use-editor-immersive-mode';
import { useEditorVisualEditingHandlers } from './use-editor-visual-editing-handlers';
import { useEditorVisualUnlock } from './use-editor-visual-unlock';
import { useEditorWechatPreparation } from './use-editor-wechat-preparation';

type FormalPreviewWaiter = Readonly<{
  markdown: string;
  resolve: (surface: HTMLElement | null) => void;
}>;

export type UseEditorVisualPreviewBridgeOptions = Readonly<{
  cancelVisualUnlockPreparationRef: SharedRef<() => void>;
  closeForToolbar: (focusTarget?: HTMLElement) => void;
  codeThemePreparationGenerationRef: SharedRef<number>;
  codeThemePreparationRef: SharedRef<CodeThemePreparation | null>;
  contextMenuStrings: EditorRootProps['contextMenuStrings'];
  documentSession: EditorDocumentSession | null;
  enhancementPort: EditorRootProps['enhancementPort'];
  immersiveEnvironment: EditorRootProps['immersiveEnvironment'];
  immersivePreferencesPort: EditorRootProps['immersivePreferencesPort'];
  immersiveRef: SharedRef<boolean>;
  notifyContextMenuReadiness: () => void;
  prepareSourceMutationRef: SharedRef<() => boolean>;
  preview: EditorRootProps['preview'];
  previewAppearanceRef: SharedRef<AppearanceState>;
  previewRefreshPendingRef: SharedRef<boolean>;
  previewRuntimeRef: SharedRef<PreviewSurfaceRuntime | null>;
  publishEditorStatus: (status: EditorStatus) => void;
  releasePendingContextResourcesRef: SharedRef<
    (reason?: 'cancelled' | 'unavailable') => void
  >;
  reportFailure: (code: string) => void;
  rootActiveRef: SharedRef<boolean>;
  rootRef: SharedRef<HTMLDivElement | null>;
  scrollSyncPort: EditorRootProps['scrollSyncPort'];
  setEditorStatusState: (
    updater: (current: EditorStatusState) => EditorStatusState
  ) => void;
  settings: EditorRootProps['settings'];
  submissionField: HTMLTextAreaElement;
  toolbarSessionRef: SharedRef<EditorToolbarSession | null>;
  visualEditorRuntimeRef: SharedRef<ImmersiveVisualEditorRuntime | null>;
  visualPreviewEditingRef: SharedRef<boolean>;
  visualPreviewWindowRequestedRef: SharedRef<boolean>;
  wechatClipboard: EditorRootProps['wechatClipboard'];
  wechatExport: EditorRootProps['wechatExport'];
}>;

export function useEditorVisualPreviewBridge({
  cancelVisualUnlockPreparationRef,
  closeForToolbar,
  codeThemePreparationGenerationRef,
  codeThemePreparationRef,
  contextMenuStrings,
  documentSession,
  enhancementPort,
  immersiveEnvironment,
  immersivePreferencesPort,
  immersiveRef,
  notifyContextMenuReadiness,
  prepareSourceMutationRef,
  preview,
  previewAppearanceRef,
  previewRefreshPendingRef,
  previewRuntimeRef,
  publishEditorStatus,
  releasePendingContextResourcesRef,
  reportFailure,
  rootActiveRef,
  rootRef,
  scrollSyncPort,
  setEditorStatusState,
  settings,
  submissionField,
  toolbarSessionRef,
  visualEditorRuntimeRef,
  visualPreviewEditingRef,
  visualPreviewWindowRequestedRef,
  wechatClipboard,
  wechatExport
}: UseEditorVisualPreviewBridgeOptions) {
  const lastVisualFailureRef = useRef<string | null>(null);
  const scheduledPreviewRuntimeRef = useRef<PreviewSurfaceRuntime | null>(null);
  const previewRevisionRef = useRef(0);
  const latestPreviewRequestRef = useRef<Readonly<{
    markdown: string;
    signature: string;
  }> | null>(null);
  const acceptedPreviewMarkdownRef = useRef<string | null>(null);
  const formalPreviewWaitersRef = useRef<Set<FormalPreviewWaiter>>(new Set());
  const syncedVisualCodeFramesRef = useRef<WeakSet<HTMLElement>>(new WeakSet());
  const layoutScrollRestoreRef = useRef<LayoutScrollRestoreEntry | null>(null);
  const leaveVisualPreviewRef = useRef<
    (options?: Readonly<{ suppressRefresh?: boolean }>) => boolean
  >(() => false);

  const [immersive, setImmersive] = useState(false);
  immersiveRef.current = immersive;
  const [immersiveMode, setImmersiveMode] = useState<ImmersiveViewMode>(() =>
    immersiveModeFromEditingMode(settings.general.editingMode)
  );
  const immersiveModeRef = useRef(immersiveMode);
  immersiveModeRef.current = immersiveMode;

  const [previewRuntimeGeneration, setPreviewRuntimeGeneration] = useState(0);
  const [previewRefreshRevision, setPreviewRefreshRevision] = useState(0);
  const [previewSurfaceStatus, setPreviewSurfaceStatus] =
    useState<PreviewSurfaceStatus>('loading');
  const previewSurfaceStatusRef = useRef(previewSurfaceStatus);
  previewSurfaceStatusRef.current = previewSurfaceStatus;

  const [visualPreviewSnapshot, setVisualPreviewSnapshot] =
    useState<EditorVisualPreviewSnapshot | null>(null);
  const visualPreviewSnapshotRef = useRef(visualPreviewSnapshot);
  visualPreviewSnapshotRef.current = visualPreviewSnapshot;

  const [visualPreviewEditing, setVisualPreviewEditing] = useState(false);
  visualPreviewEditingRef.current = visualPreviewEditing;
  const visualPreviewLockingRef = useRef(false);
  const [visualPreviewUnlocking, setVisualPreviewUnlocking] = useState(false);
  const visualPreviewUnlockingRef = useRef(visualPreviewUnlocking);
  visualPreviewUnlockingRef.current = visualPreviewUnlocking;
  const [visualPreviewPending, setVisualPreviewPending] = useState(false);
  const visualPreviewPendingRef = useRef(visualPreviewPending);
  visualPreviewPendingRef.current = visualPreviewPending;
  const visualDocumentEndHistoryPendingRef = useRef(false);
  const [, setVisualWindowedHistoryBranchHeld] = useState(false);
  const [visualEditorSurface, setVisualEditorSurface] =
    useState<HTMLElement | null>(null);
  const [visualEditorGeneration, setVisualEditorGeneration] = useState(0);
  const [visualPreviewChanged, setVisualPreviewChanged] = useState(false);
  const visualPreviewChangedRef = useRef(visualPreviewChanged);
  visualPreviewChangedRef.current = visualPreviewChanged;

  const settleFormalPreviewWaiters = useCallback(
    (resolvedMarkdown: string | null, surface: HTMLElement | null) => {
      if (0 === formalPreviewWaitersRef.current.size) return;
      for (const waiter of Array.from(formalPreviewWaitersRef.current)) {
        if (null === resolvedMarkdown || waiter.markdown === resolvedMarkdown) {
          formalPreviewWaitersRef.current.delete(waiter);
          waiter.resolve(null === resolvedMarkdown ? null : surface);
        }
      }
    },
    []
  );

  useEffect(
    () => () => {
      settleFormalPreviewWaiters(null, null);
      enhancementPort.dispose?.();
    },
    [enhancementPort, settleFormalPreviewWaiters]
  );

  const hasUnsyncedVisualChanges = useCallback((): boolean => {
    const currentMarkdown =
      documentSession?.document.getValue() ?? submissionField.value;
    return (
      visualPreviewChangedRef.current
      || acceptedPreviewMarkdownRef.current !== currentMarkdown
      || 'ready' !== previewSurfaceStatusRef.current
    );
  }, [documentSession, submissionField]);

  const {
    cancelWechatBackgroundPreparation,
    scheduleCurrentWechatPreviewPreparation,
    scheduleWechatPreviewPreparation
  } = useEditorWechatPreparation({
    immersive,
    immersiveEnvironment,
    immersiveMode,
    previewRuntimeGeneration,
    previewRuntimeRef,
    previewSurfaceStatusRef,
    rootActiveRef,
    visualPreviewEditingRef,
    visualPreviewLockingRef,
    visualPreviewUnlockingRef,
    visualPreviewWindowRequestedRef,
    wechatClipboard,
    wechatExportEnabled: wechatExport.enabled
  });

  const {
    cancelVisualPreviewWindowUnlock,
    cancelVisualUnlockPreparation,
    handlePreviewWindowReady,
    leaveVisualPreview,
    prepareGeneratedSourceNavigation,
    prepareSourceMutation,
    prepareSourceMutationWithPreview,
    prepareVisualSource,
    requestVisualPreviewUnlock
  } = useEditorVisualUnlock({
    cancelWechatBackgroundPreparation,
    codeThemePreparationGenerationRef,
    codeThemePreparationRef,
    documentSession,
    enhancementPort,
    hasUnsyncedVisualChanges,
    immersiveModeRef,
    immersiveRef,
    lastVisualFailureRef,
    layoutScrollRestoreRef,
    leaveVisualPreviewRef,
    notifyContextMenuReadiness,
    previewAppearanceRef,
    previewRefreshPendingRef,
    previewRuntimeRef,
    previewSurfaceStatusRef,
    reportFailure,
    rootActiveRef,
    setImmersiveMode,
    setPreviewRefreshRevision,
    setVisualPreviewChanged,
    setVisualPreviewEditing,
    setVisualPreviewPending,
    setVisualPreviewUnlocking,
    visualEditorRuntimeRef,
    visualPreviewChangedRef,
    visualPreviewEditingRef,
    visualPreviewLockingRef,
    visualPreviewWindowRequestedRef
  });

  prepareSourceMutationRef.current = prepareSourceMutation;
  cancelVisualUnlockPreparationRef.current = cancelVisualUnlockPreparation;

  const visualHandlers = useEditorVisualEditingHandlers({
    cancelWechatBackgroundPreparation,
    contextMenuStrings,
    documentSession,
    enhancementPort,
    immersiveEnvironment,
    lastVisualFailureRef,
    leaveVisualPreview,
    leaveVisualPreviewRef,
    notifyContextMenuReadiness,
    preview,
    previewRefreshPendingRef,
    previewRuntimeRef,
    previewSurfaceStatusRef,
    publishEditorStatus,
    reportFailure,
    rootActiveRef,
    rootRef,
    setEditorStatusState,
    setPreviewSurfaceStatus,
    setVisualEditorGeneration,
    setVisualEditorSurface,
    setVisualPreviewChanged,
    setVisualPreviewPending,
    setVisualWindowedHistoryBranchHeld,
    syncedVisualCodeFramesRef,
    visualDocumentEndHistoryPendingRef,
    visualEditorRuntimeRef
  });

  const {
    changeImmersiveMode,
    enterImmersive,
    exitImmersive,
    immersiveLayoutClass,
    immersivePreferences,
    immersiveToggleRef
  } = useEditorImmersiveMode({
    cancelVisualUnlockPreparation,
    closeForToolbar,
    documentSession,
    hasUnsyncedVisualChanges,
    immersive,
    immersiveEnvironment,
    immersiveMode,
    immersiveModeRef,
    immersivePreferencesPort,
    immersiveRef,
    layoutScrollRestoreRef,
    notifyContextMenuReadiness,
    prepareSourceMutationWithPreview,
    previewRuntimeGeneration,
    previewRuntimeRef,
    reportFailure,
    rootActiveRef,
    rootRef,
    scrollSyncEnabled: settings.general.syncScroll,
    scrollSyncPort,
    setEditorStatusState,
    setImmersive,
    setImmersiveMode,
    toolbarSessionRef,
    visualPreviewEditingRef,
    visualPreviewPending,
    visualPreviewPendingRef,
    visualPreviewWindowRequestedRef
  });

  const handlePreviewReady = useCallback(
    (runtime: PreviewSurfaceRuntime) => {
      previewRuntimeRef.current = runtime;
      setPreviewRuntimeGeneration((generation) => generation + 1);
      notifyContextMenuReadiness();
    },
    [notifyContextMenuReadiness, previewRuntimeRef]
  );

  const handlePreviewImageReadinessChange = useCallback(() => {
    notifyContextMenuReadiness();
  }, [notifyContextMenuReadiness]);

  const handlePreviewDispose = useCallback(
    (runtime: PreviewSurfaceRuntime) => {
      cancelWechatBackgroundPreparation();
      cancelVisualPreviewWindowUnlock();
      releasePendingContextResourcesRef.current();
      settleFormalPreviewWaiters(null, null);
      notifyContextMenuReadiness();
      if (previewRuntimeRef.current === runtime) {
        previewRuntimeRef.current = null;
        acceptedPreviewMarkdownRef.current = null;
        setPreviewRuntimeGeneration((generation) => generation + 1);
      }
      if (scheduledPreviewRuntimeRef.current === runtime) {
        scheduledPreviewRuntimeRef.current = null;
      }
    },
    [
      cancelVisualPreviewWindowUnlock,
      cancelWechatBackgroundPreparation,
      notifyContextMenuReadiness,
      previewRuntimeRef,
      releasePendingContextResourcesRef,
      settleFormalPreviewWaiters
    ]
  );

  const handlePreviewSnapshotReady = useCallback(
    (
      html: SafePreviewHtml,
      signature: string,
      editMap: PreviewEditMap | null
    ) => {
      const latestRequest = latestPreviewRequestRef.current;
      const currentMarkdown =
        documentSession?.document.getValue() ?? submissionField.value;
      if (
        null !== latestRequest
        && latestRequest.signature === signature
        && latestRequest.markdown === currentMarkdown
      ) {
        acceptedPreviewMarkdownRef.current = latestRequest.markdown;
        visualHandlers.clearVisualFailureState();
      } else if (null === latestRequest && signature === preview.signature) {
        acceptedPreviewMarkdownRef.current = currentMarkdown;
      }
      setVisualPreviewSnapshot((current) => ({
        editMap,
        html,
        revision: (current?.revision ?? 0) + 1,
        signature
      }));
      if (acceptedPreviewMarkdownRef.current !== null) {
        settleFormalPreviewWaiters(
          acceptedPreviewMarkdownRef.current,
          previewRuntimeRef.current?.surface ?? null
        );
      }
      notifyContextMenuReadiness();
      scheduleCurrentWechatPreviewPreparation();
    },
    [
      documentSession,
      notifyContextMenuReadiness,
      preview.signature,
      previewRuntimeRef,
      scheduleCurrentWechatPreviewPreparation,
      settleFormalPreviewWaiters,
      submissionField,
      visualHandlers.clearVisualFailureState
    ]
  );

  const handlePreviewStatusChange = useCallback(
    (status: PreviewSurfaceStatus) => {
      if ('ready' !== status) {
        cancelWechatBackgroundPreparation();
      }
      if ('error' === status) {
        cancelVisualUnlockPreparation();
      }
      previewSurfaceStatusRef.current = status;
      setPreviewSurfaceStatus(status);
      if ('ready' === status) previewRefreshPendingRef.current = false;
      if ('empty' === status || 'error' === status) {
        acceptedPreviewMarkdownRef.current = null;
        settleFormalPreviewWaiters(null, null);
      }
      if ('empty' === status) setVisualPreviewSnapshot(null);
      notifyContextMenuReadiness();
    },
    [
      cancelVisualUnlockPreparation,
      cancelWechatBackgroundPreparation,
      notifyContextMenuReadiness,
      previewRefreshPendingRef,
      settleFormalPreviewWaiters
    ]
  );

  const getNextPreviewRevision = useCallback(
    () => ++previewRevisionRef.current,
    []
  );

  const schedulePreviewMarkdown = useCallback(
    (markdown: string, immediate = false): string => {
      const runtime = previewRuntimeRef.current;
      if (!runtime) {
        throw new Error('preview-runtime-unavailable');
      }
      const revision = ++previewRevisionRef.current;
      const request = previewRequest(
        markdown,
        preview,
        previewAppearanceRef.current,
        revision
      );
      latestPreviewRequestRef.current = {
        markdown,
        signature: request.signature
      };
      runtime.session.schedule(request, immediate);
      return request.signature;
    },
    [preview, previewAppearanceRef, previewRuntimeRef]
  );

  const schedulePreview = useCallback(
    (immediate = false) => {
      schedulePreviewMarkdown(
        documentSession?.document.getValue() ?? submissionField.value,
        immediate
      );
    },
    [documentSession, schedulePreviewMarkdown, submissionField]
  );

  const waitForFreshFormalPreview = useCallback((): Promise<HTMLElement | null> => {
    const runtime = previewRuntimeRef.current;
    if (!runtime || !rootActiveRef.current) {
      return Promise.resolve(null);
    }
    const targetMarkdown =
      documentSession?.document.getValue() ?? submissionField.value;
    if (
      'ready' === previewSurfaceStatusRef.current
      && acceptedPreviewMarkdownRef.current === targetMarkdown
    ) {
      return Promise.resolve(runtime.surface);
    }
    return new Promise<HTMLElement | null>((resolve) => {
      const waiter: FormalPreviewWaiter = {
        markdown: targetMarkdown,
        resolve
      };
      formalPreviewWaitersRef.current.add(waiter);
      try {
        schedulePreviewMarkdown(targetMarkdown, true);
      } catch {
        formalPreviewWaitersRef.current.delete(waiter);
        resolve(null);
      }
    });
  }, [
    documentSession,
    previewRuntimeRef,
    rootActiveRef,
    schedulePreviewMarkdown,
    submissionField
  ]);

  useLayoutEffect(() => {
    void previewRuntimeGeneration;
    const runtime = previewRuntimeRef.current;
    if (!runtime || !documentSession || visualPreviewEditing) return;
    const unsubscribeDocument = documentSession.document.subscribe(() => {
      schedulePreview(false);
    });
    if (scheduledPreviewRuntimeRef.current !== runtime) {
      scheduledPreviewRuntimeRef.current = runtime;
      schedulePreview(true);
    }

    return unsubscribeDocument;
  }, [
    documentSession,
    previewRuntimeGeneration,
    previewRuntimeRef,
    schedulePreview,
    visualPreviewEditing
  ]);

  useLayoutEffect(() => {
    void previewRuntimeGeneration;
    if (
      0 === previewRefreshRevision
      || visualPreviewEditing
      || !previewRuntimeRef.current
    ) {
      return;
    }
    setPreviewRefreshRevision(0);
    schedulePreview(true);
  }, [
    previewRefreshRevision,
    previewRuntimeGeneration,
    previewRuntimeRef,
    schedulePreview,
    visualPreviewEditing
  ]);

  const getVisualGeneratedPreviewIdentity = useCallback(
    () => previewRuntimeRef.current?.getGeneratedPreviewIdentity() ?? null,
    [previewRuntimeRef]
  );

  return {
    applyVisualCanonicalChange: visualHandlers.applyVisualCanonicalChange,
    cancelVisualPreviewWindowUnlock,
    cancelVisualUnlockPreparation,
    changeImmersiveMode,
    enterImmersive,
    executeVisualToolbarCommand: visualHandlers.executeVisualToolbarCommand,
    exitImmersive,
    focusVisualPreview: visualHandlers.focusVisualPreview,
    getNextPreviewRevision,
    getVisualGeneratedPreviewIdentity,
    handlePreviewDispose,
    handlePreviewImageReadinessChange,
    handlePreviewReady,
    handlePreviewSnapshotReady,
    handlePreviewStatusChange,
    handlePreviewWindowReady,
    handleVisualCanonicalDocumentChange:
      visualHandlers.handleVisualCanonicalDocumentChange,
    handleVisualEditorDispose: visualHandlers.handleVisualEditorDispose,
    handleVisualEditorReady: visualHandlers.handleVisualEditorReady,
    handleVisualFailure: visualHandlers.handleVisualFailure,
    handleVisualMarkdownChange: visualHandlers.handleVisualMarkdownChange,
    immersive,
    immersiveLayoutClass,
    immersiveMode,
    immersivePreferences,
    immersiveToggleRef,
    leaveVisualPreview,
    prepareGeneratedSourceNavigation,
    prepareSourceMutation,
    prepareSourceMutationWithPreview,
    prepareVisualSource,
    previewRuntimeGeneration,
    previewSurfaceStatus,
    previewSurfaceStatusRef,
    requestVisualPreviewUnlock,
    scheduleCurrentWechatPreviewPreparation,
    schedulePreview,
    scheduleWechatPreviewPreparation,
    visualEditorGeneration,
    visualEditorSurface,
    visualPreviewChanged,
    visualPreviewEditing,
    visualPreviewSnapshot,
    visualPreviewUnlocking,
    visualPreviewWindowed: false,
    waitForFreshFormalPreview
  };
}
