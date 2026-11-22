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
import { DEFAULT_PREVIEW_WINDOW_MAX_MOUNTED } from '../../features/live-preview/model/preview-window-model';
import type {
  PreviewAcceptedWindowSnapshot,
  PreviewSourceSelection,
  PreviewSurfaceRuntime,
  PreviewSurfaceStatus
} from '../../features/live-preview/ui/PreviewSurfaceOwner';
import type { EditorToolbarSession } from '../../features/toolbar/ui/EditorToolbar';
import {
  immersiveModeFromEditingMode,
  previewRequest,
  schedulePreviewWithDocumentEndPin,
  visualPreviewSourceHasEditableMap,
  visualPreviewSurfaceUsesWindowedOwner,
  visualPreviewSurfaceWindowedForVisibility,
  visualPreviewUsesWindowedOwner
} from './editor-root-helpers';
import type {
  CodeThemePreparation,
  EditorRootProps,
  EditorStatus,
  EditorStatusState,
  EditorVisualPreviewSnapshot,
  ImmersiveVisualEditorRuntime,
  LayoutScrollRestoreEntry,
  SharedRef,
  VisualPreviewWindowRequest
} from './editor-root-types';
import { useEditorImmersiveMode } from './use-editor-immersive-mode';
import { useEditorVisualEditingHandlers } from './use-editor-visual-editing-handlers';
import { useEditorVisualUnlock } from './use-editor-visual-unlock';
import { useEditorWechatPreparation } from './use-editor-wechat-preparation';

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
  const acceptedWindowSnapshotKeyRef = useRef<number | null>(null);
  const scheduledPreviewRuntimeRef = useRef<PreviewSurfaceRuntime | null>(null);
  const previewRevisionRef = useRef(0);
  const latestPreviewRequestRef = useRef<Readonly<{
    markdown: string;
    signature: string;
  }> | null>(null);
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
  const [
    acceptedWindowSnapshotGeneration,
    setAcceptedWindowSnapshotGeneration
  ] = useState(0);
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
  const [visualPreviewWindowRequested, setVisualPreviewWindowRequested] =
    useState(false);
  const visualPreviewSurfaceWindowedRef = useRef(false);
  const visualPreviewWindowUnlockRef =
    useRef<VisualPreviewWindowRequest | null>(null);
  const visualPreviewLockingRef = useRef(false);
  /**
   * The request that owns the current window hold. A superseded preparation
   * may release only its own hold; a newer request's hold is never cleared by
   * an older one resuming from an await.
   */
  const visualPreviewHoldOwnerRef = useRef<object | null>(null);
  const [visualPreviewUnlocking, setVisualPreviewUnlocking] = useState(false);
  const visualPreviewUnlockingRef = useRef(visualPreviewUnlocking);
  visualPreviewUnlockingRef.current = visualPreviewUnlocking;
  const [visualPreviewPending, setVisualPreviewPending] = useState(false);
  const visualPreviewPendingRef = useRef(visualPreviewPending);
  visualPreviewPendingRef.current = visualPreviewPending;
  /**
   * One-shot unlock signal: incremented when the unlock owner enables visual
   * editing so the activation effect places the canonical caret exactly once.
   */
  const [visualResumeCanonicalToken, setVisualResumeCanonicalToken] =
    useState(0);
  /**
   * A resume applies only when the unlock returns from a previous editing
   * session (the lock/mode exit). A first entry into visual editing never
   * re-selects anything.
   */
  const visualPreviewLeftEditingRef = useRef(false);
  const [visualDocumentEndHistoryPending, setVisualDocumentEndHistoryPending] =
    useState(false);
  const visualDocumentEndHistoryPendingRef = useRef(false);
  visualDocumentEndHistoryPendingRef.current = visualDocumentEndHistoryPending;
  const [visualWindowedHistoryBranchHeld, setVisualWindowedHistoryBranchHeld] =
    useState(false);
  const [visualEditorSurface, setVisualEditorSurface] =
    useState<HTMLElement | null>(null);
  const [visualEditorGeneration, setVisualEditorGeneration] = useState(0);
  const [visualPreviewChanged, setVisualPreviewChanged] = useState(false);

  const visualPreviewHasEditableMap = visualPreviewSourceHasEditableMap(
    visualPreviewSnapshot,
    documentSession?.document.getValue() ?? null
  );
  const visualPreviewNeedsWindow =
    (visualPreviewSnapshot?.editMap?.blocks.length ?? 0)
    > DEFAULT_PREVIEW_WINDOW_MAX_MOUNTED;
  const previewVisible = immersive
    ? 'source' !== immersiveMode
    : 'source' !== settings.general.editingMode;
  // The previous visual owner and whether its replacement is a caret
  // transfer. This is deliberately a ref read at the top of the render and
  // written back at the end: a derived-state update here would re-render just
  // to describe the render that is already running.
  const visualOwnerSelectionResumeRef = useRef<
    Readonly<{
      editing: boolean;
      transferred: boolean;
      windowed: boolean;
    }>
  >({ editing: false, transferred: false, windowed: false });
  const previousVisualOwnerSelectionResume =
    visualOwnerSelectionResumeRef.current;
  // The owner identity never includes the sticky retention term below; that
  // term only decides which surface stays mounted while its transfer settles.
  const primaryVisualPreviewWindowed =
    visualPreviewUsesWindowedOwner(
      visualPreviewNeedsWindow,
      visualDocumentEndHistoryPending || visualWindowedHistoryBranchHeld,
      visualPreviewEditing,
      visualPreviewWindowRequested
    ) || (visualPreviewWindowRequestedRef.current && visualPreviewEditing);
  const visualPreviewWindowed =
    primaryVisualPreviewWindowed
    || (
      // The accepted map may cross the threshold before its transfer settles.
      // Keep that transfer's Windowed owner until the surface can change with it.
      visualPreviewPending
      && visualPreviewEditing
      && previousVisualOwnerSelectionResume.editing
      && previousVisualOwnerSelectionResume.windowed
    );
  const currentVisualPreviewSurfaceWindowed =
    visualPreviewSurfaceUsesWindowedOwner(
      visualPreviewNeedsWindow,
      visualDocumentEndHistoryPending || visualWindowedHistoryBranchHeld,
      visualPreviewPending,
      visualPreviewEditing,
      visualPreviewWindowRequested
    );
  const visualPreviewSurfaceWindowed =
    visualPreviewSurfaceWindowedForVisibility(
      currentVisualPreviewSurfaceWindowed
        || (visualPreviewWindowRequestedRef.current && visualPreviewEditing)
        || (!previewVisible && visualPreviewSurfaceWindowedRef.current),
      previewVisible,
      visualPreviewNeedsWindow
    );
  visualPreviewSurfaceWindowedRef.current = visualPreviewSurfaceWindowed;
  // Both visual owners share the sink, but changing its window projection
  // replaces its children. A native range left on that sink is not a caret
  // transfer. Arm the incoming owner's accepted-source selection lifecycle
  // before it mounts, without changing the canonical selection or history.
  const visualOwnerChanged =
    previousVisualOwnerSelectionResume.editing !== visualPreviewEditing
    || previousVisualOwnerSelectionResume.windowed
      !== primaryVisualPreviewWindowed;
  const visualOwnerSelectionTransferred = visualOwnerChanged
    ? visualPreviewEditing
      && previousVisualOwnerSelectionResume.editing
      && previousVisualOwnerSelectionResume.windowed
        !== primaryVisualPreviewWindowed
    : previousVisualOwnerSelectionResume.transferred;
  if (visualOwnerChanged && visualOwnerSelectionTransferred) {
    // One token per real transfer; the ref write below stops the render this
    // increment schedules from counting the same transition again.
    setVisualResumeCanonicalToken((token) => token + 1);
  }
  visualOwnerSelectionResumeRef.current = {
    editing: visualPreviewEditing,
    transferred: visualOwnerSelectionTransferred,
    windowed: primaryVisualPreviewWindowed
  };

  useEffect(() => () => enhancementPort.dispose?.(), [enhancementPort]);

  const getAcceptedWindowSnapshot = useCallback(
    (): PreviewAcceptedWindowSnapshot | null =>
      previewRuntimeRef.current?.getAcceptedWindowSnapshot() ?? null,
    [previewRuntimeRef]
  );

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
    visualEditorRuntimeRef,
    visualEditorSurface,
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
    acceptedWindowSnapshotKeyRef,
    cancelWechatBackgroundPreparation,
    codeThemePreparationGenerationRef,
    codeThemePreparationRef,
    documentSession,
    enhancementPort,
    getAcceptedWindowSnapshot,
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
    setAcceptedWindowSnapshotGeneration,
    setImmersiveMode,
    setPreviewRefreshRevision,
    setPreviewSurfaceStatus,
    setVisualDocumentEndHistoryPending,
    setVisualPreviewChanged,
    setVisualPreviewEditing,
    setVisualPreviewPending,
    setVisualPreviewUnlocking,
    setVisualPreviewWindowRequested,
    setVisualResumeCanonicalToken,
    setVisualWindowedHistoryBranchHeld,
    visualDocumentEndHistoryPendingRef,
    visualEditorRuntimeRef,
    visualPreviewEditingRef,
    visualPreviewHoldOwnerRef,
    visualPreviewLeftEditingRef,
    visualPreviewLockingRef,
    visualPreviewNeedsWindow,
    visualPreviewSnapshotRef,
    visualPreviewWindowRequestedRef,
    visualPreviewWindowUnlockRef
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
      acceptedWindowSnapshotKeyRef.current = null;
      setAcceptedWindowSnapshotGeneration((generation) => generation + 1);
      setPreviewRuntimeGeneration((generation) => generation + 1);
      notifyContextMenuReadiness();
    },
    [notifyContextMenuReadiness, previewRuntimeRef]
  );

  const handlePreviewImageReadinessChange = useCallback(() => {
    notifyContextMenuReadiness();
  }, [notifyContextMenuReadiness]);

  const prepareVisualWindowBlockAdoption = useCallback(
    (node: HTMLElement): (() => boolean) | null => {
      const runtime = previewRuntimeRef.current;
      if (!runtime) return null;
      return runtime.prepareWindowBlockAdoption(node);
    },
    [previewRuntimeRef]
  );

  const retainCompositionSurface = useCallback((): Readonly<{
    release: () => void;
  }> => {
    const runtime = previewRuntimeRef.current;
    if (!runtime) throw new Error('preview-runtime-unavailable');
    return runtime.retainCompositionSurface();
  }, [previewRuntimeRef]);

  const getAcceptedWindowRow = useCallback(
    (request: Parameters<PreviewSurfaceRuntime['getAcceptedWindowRow']>[0]) =>
      previewRuntimeRef.current?.getAcceptedWindowRow(request) ?? null,
    [previewRuntimeRef]
  );

  const getAcceptedReferenceSource = useCallback(
    (
      request: Parameters<
        PreviewSurfaceRuntime['getAcceptedReferenceSource']
      >[0]
    ) => previewRuntimeRef.current?.getAcceptedReferenceSource(request) ?? null,
    [previewRuntimeRef]
  );

  const revealAcceptedWindowRow = useCallback(
    (
      request: Parameters<PreviewSurfaceRuntime['revealAcceptedWindowRow']>[0]
    ) => previewRuntimeRef.current?.revealAcceptedWindowRow(request) ?? null,
    [previewRuntimeRef]
  );

  const handlePreviewDispose = useCallback(
    (runtime: PreviewSurfaceRuntime) => {
      cancelWechatBackgroundPreparation();
      cancelVisualPreviewWindowUnlock();
      releasePendingContextResourcesRef.current();
      notifyContextMenuReadiness();
      if (rootActiveRef.current) {
        visualDocumentEndHistoryPendingRef.current = false;
        setVisualDocumentEndHistoryPending(false);
        setVisualWindowedHistoryBranchHeld(false);
      }
      if (previewRuntimeRef.current === runtime) {
        previewRuntimeRef.current = null;
        acceptedWindowSnapshotKeyRef.current = null;
        setAcceptedWindowSnapshotGeneration((generation) => generation + 1);
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
      rootActiveRef
    ]
  );

  const handlePreviewSnapshotReady = useCallback(
    (
      html: SafePreviewHtml,
      signature: string,
      editMap: PreviewEditMap | null
    ) => {
      cancelVisualPreviewWindowUnlock();
      cancelVisualUnlockPreparation();
      const latestRequest = latestPreviewRequestRef.current;
      const currentMarkdown =
        documentSession?.document.getValue() ?? submissionField.value;
      if (
        null !== latestRequest
        && latestRequest.signature === signature
        && latestRequest.markdown === currentMarkdown
      ) {
        visualHandlers.clearVisualFailureState();
      }
      setVisualPreviewSnapshot((current) => ({
        editMap,
        html,
        revision: (current?.revision ?? 0) + 1,
        signature
      }));
      notifyContextMenuReadiness();
      // A source edit can produce several Preview snapshots in one typing
      // burst. Defer the expensive export walk until the surface is stable so
      // ordinary editing does not serialize the whole article on every render.
      scheduleCurrentWechatPreviewPreparation();
    },
    [
      cancelVisualPreviewWindowUnlock,
      cancelVisualUnlockPreparation,
      documentSession,
      notifyContextMenuReadiness,
      scheduleCurrentWechatPreviewPreparation,
      submissionField,
      visualHandlers.clearVisualFailureState
    ]
  );

  const handlePreviewStatusChange = useCallback(
    (status: PreviewSurfaceStatus) => {
      if ('ready' !== status) {
        cancelWechatBackgroundPreparation();
        cancelVisualPreviewWindowUnlock();
        cancelVisualUnlockPreparation();
      }
      // The ref is the live value context-menu readiness reads, so it has to
      // change with the callback rather than on the next render. A demand kept
      // pending by the published status would otherwise never be woken when
      // the status settles.
      previewSurfaceStatusRef.current = status;
      setPreviewSurfaceStatus(status);
      if ('ready' === status) previewRefreshPendingRef.current = false;
      if ('empty' === status) setVisualPreviewSnapshot(null);
      notifyContextMenuReadiness();
    },
    [
      cancelVisualPreviewWindowUnlock,
      cancelVisualUnlockPreparation,
      cancelWechatBackgroundPreparation,
      notifyContextMenuReadiness,
      previewRefreshPendingRef
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

  const handleVisualPreviewRequest = useCallback(
    (markdown: string, options?: Readonly<{ immediate?: boolean }>) =>
      schedulePreviewMarkdown(markdown, options?.immediate ?? true),
    [schedulePreviewMarkdown]
  );

  const handleVisualPreviewAtDocumentEnd = useCallback(
    (
      markdown: string,
      sourceSelection?: PreviewSourceSelection,
      options?: Readonly<{ immediate?: boolean }>
    ) => {
      const runtime = previewRuntimeRef.current;
      if (!runtime) {
        throw new Error('preview-runtime-unavailable');
      }
      if (!documentSession) {
        throw new Error('editor-document-session-unavailable');
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
      return schedulePreviewWithDocumentEndPin(
        runtime,
        request,
        (pending) => {
          if (rootActiveRef.current) {
            visualDocumentEndHistoryPendingRef.current = pending;
            setVisualDocumentEndHistoryPending(pending);
          }
        },
        () => {
          if (rootActiveRef.current) {
            setVisualWindowedHistoryBranchHeld(
              documentSession.document.getHistoryState().redoDepth > 0
            );
          }
        },
        sourceSelection,
        options?.immediate ?? true
      );
    },
    [
      documentSession,
      preview,
      previewAppearanceRef,
      previewRuntimeRef,
      rootActiveRef
    ]
  );

  useLayoutEffect(() => {
    void previewRuntimeGeneration;
    const runtime = previewRuntimeRef.current;
    if (!runtime || !documentSession || visualPreviewEditing) return;
    // CodeMirror is the canonical document source. The hidden WordPress
    // field remains synchronized for submission, but its bridge input event
    // must not be a second Preview trigger: a late bridge event can race an
    // immediate theme transition and submit two different Markdown values.
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

  const prepareVisualGeneratedContentTarget = useCallback<
    PreviewSurfaceRuntime['prepareGeneratedContentTarget']
  >(
    (request) =>
      previewRuntimeRef.current?.prepareGeneratedContentTarget(request) ?? null,
    [previewRuntimeRef]
  );

  const prepareVisualImageTarget = useCallback<
    PreviewSurfaceRuntime['prepareImageTarget']
  >(
    (request) => previewRuntimeRef.current?.prepareImageTarget(request) ?? null,
    [previewRuntimeRef]
  );

  const prepareVisualImageTargetBySelection = useCallback<
    PreviewSurfaceRuntime['prepareImageTargetBySelection']
  >(
    (request) =>
      previewRuntimeRef.current?.prepareImageTargetBySelection(request) ?? null,
    [previewRuntimeRef]
  );

  return {
    acceptedWindowSnapshotGeneration,
    applyVisualCanonicalChange: visualHandlers.applyVisualCanonicalChange,
    cancelVisualPreviewWindowUnlock,
    cancelVisualUnlockPreparation,
    changeImmersiveMode,
    enterImmersive,
    executeVisualToolbarCommand: visualHandlers.executeVisualToolbarCommand,
    exitImmersive,
    focusVisualPreview: visualHandlers.focusVisualPreview,
    getAcceptedReferenceSource,
    getAcceptedWindowRow,
    getAcceptedWindowSnapshot,
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
    handleVisualPendingChange: visualHandlers.handleVisualPendingChange,
    handleVisualPreviewAtDocumentEnd,
    handleVisualPreviewRequest,
    handleVisualTransferFailure: visualHandlers.handleVisualTransferFailure,
    immersive,
    immersiveLayoutClass,
    immersiveMode,
    immersivePreferences,
    immersiveToggleRef,
    leaveVisualPreview,
    prepareGeneratedSourceNavigation,
    prepareSourceMutation,
    prepareSourceMutationWithPreview,
    prepareVisualGeneratedContentTarget,
    prepareVisualImageTarget,
    prepareVisualImageTargetBySelection,
    prepareVisualSource,
    prepareVisualWindowBlockAdoption,
    previewRuntimeGeneration,
    previewSurfaceStatus,
    previewSurfaceStatusRef,
    requestVisualPreviewUnlock,
    retainCompositionSurface,
    revealAcceptedWindowRow,
    scheduleCurrentWechatPreviewPreparation,
    schedulePreview,
    scheduleWechatPreviewPreparation,
    visualEditorGeneration,
    visualEditorSurface,
    visualOwnerSelectionTransferred,
    visualPreviewChanged,
    visualPreviewEditing,
    visualPreviewHasEditableMap,
    visualPreviewPending,
    visualPreviewSnapshot,
    visualPreviewSurfaceWindowed,
    visualPreviewUnlocking,
    visualPreviewWindowed,
    visualResumeCanonicalToken
  };
}
