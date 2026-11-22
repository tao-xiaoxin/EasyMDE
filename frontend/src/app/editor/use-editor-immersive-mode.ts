import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from '@wordpress/element';

import type { ImmersiveEnvironmentPort } from '../../contracts/ports/immersive-environment-port';
import type {
  ImmersivePreferencesPort,
  ImmersivePreferencesReadResult
} from '../../contracts/ports/immersive-preferences-port';
import type { ScrollSyncPort } from '../../contracts/ports/scroll-sync-port';
import type { EditorDocumentSession } from '../../features/document-source/ui/EditorDocumentSource';
import type { ImmersiveViewMode } from '../../features/immersive-editor/immersive-editor';
import type { PreviewSurfaceRuntime } from '../../features/live-preview/ui/PreviewSurfaceOwner';
import type { EditorToolbarSession } from '../../features/toolbar/ui/EditorToolbar';
import {
  immersiveLayoutClassName,
  previewScrollCanvas
} from './editor-root-helpers';
import type {
  EditorStatusState,
  LayoutScrollRestoreEntry,
  SharedRef
} from './editor-root-types';

export type UseEditorImmersiveModeOptions = Readonly<{
  cancelVisualUnlockPreparation: () => void;
  closeForToolbar: (focusTarget?: HTMLElement) => void;
  documentSession: EditorDocumentSession | null;
  immersive: boolean;
  immersiveEnvironment: ImmersiveEnvironmentPort;
  immersiveMode: ImmersiveViewMode;
  immersiveModeRef: SharedRef<ImmersiveViewMode>;
  immersivePreferencesPort: ImmersivePreferencesPort;
  immersiveRef: SharedRef<boolean>;
  layoutScrollRestoreRef: SharedRef<LayoutScrollRestoreEntry | null>;
  notifyContextMenuReadiness: () => void;
  prepareSourceMutationWithPreview: (
    options?: Readonly<{
      materialize?: boolean;
      suppressRefresh?: boolean;
      isCurrent?: () => boolean;
    }>
  ) => Promise<boolean>;
  previewRuntimeGeneration: number;
  previewRuntimeRef: SharedRef<PreviewSurfaceRuntime | null>;
  reportFailure: (code: string) => void;
  rootActiveRef: SharedRef<boolean>;
  rootRef: SharedRef<HTMLDivElement | null>;
  scrollSyncEnabled: boolean;
  scrollSyncPort: ScrollSyncPort;
  setEditorStatusState: (
    updater: (current: EditorStatusState) => EditorStatusState
  ) => void;
  setImmersive: (immersive: boolean) => void;
  setImmersiveMode: (mode: ImmersiveViewMode) => void;
  toolbarSessionRef: SharedRef<EditorToolbarSession | null>;
  visualPreviewEditingRef: SharedRef<boolean>;
  visualPreviewPending: boolean;
  visualPreviewPendingRef: SharedRef<boolean>;
  visualPreviewWindowRequestedRef: SharedRef<boolean>;
}>;

export function useEditorImmersiveMode({
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
  scrollSyncEnabled,
  scrollSyncPort,
  setEditorStatusState,
  setImmersive,
  setImmersiveMode,
  toolbarSessionRef,
  visualPreviewEditingRef,
  visualPreviewPending,
  visualPreviewPendingRef,
  visualPreviewWindowRequestedRef
}: UseEditorImmersiveModeOptions) {
  const immersiveToggleRef = useRef<HTMLButtonElement>(null);
  const restoreImmersiveFocusRef = useRef(false);
  /**
   * Every explicit view choice is one request with its own identity. A
   * preparation started for an older request must never commit after the user
   * chooses again, so the applied transition is gated on this generation, not
   * merely on the deferred slot being empty.
   */
  const immersiveModeRequestRef = useRef(0);
  /**
   * One view-mode or exit request may wait for the formal transfer that owned
   * the surface when the user asked for it. The same safe preparation runs
   * once that transfer settles; any later explicit request replaces it.
   */
  const deferredImmersiveModeRef = useRef<Readonly<{
    generation: number;
    mode: ImmersiveViewMode | null;
  }> | null>(null);

  const [immersivePreferences, setImmersivePreferences] =
    useState<ImmersivePreferencesReadResult>(() =>
      immersivePreferencesPort.read()
    );

  const immersiveLayoutClass = immersiveLayoutClassName(
    immersive,
    immersiveMode
  );

  // Entering immersive, switching view mode, and leaving each commit a new
  // layout class. CodeMirror's own scroll snapshot is captured immediately
  // before that state update and restored here, after the class has committed,
  // so its measure loop settles on the same scroll position instead of a
  // transient viewport. The session owns every guard (teardown, detachment,
  // visual-editing parking, stale document revision).
  useLayoutEffect(() => {
    const pending = layoutScrollRestoreRef.current;
    layoutScrollRestoreRef.current = null;
    if (!pending || pending.layout === immersiveLayoutClass) return;
    pending.restore();
  });

  const captureLayoutScrollRestore = useCallback(() => {
    const restore =
      documentSession?.document.captureLayoutScrollRestore() ?? null;
    layoutScrollRestoreRef.current = restore
      ? {
          layout: immersiveLayoutClassName(
            immersiveRef.current,
            immersiveModeRef.current
          ),
          restore
        }
      : null;
  }, [
    documentSession,
    immersiveModeRef,
    immersiveRef,
    layoutScrollRestoreRef
  ]);

  useEffect(() => {
    if ('failed' === immersivePreferences.status) {
      reportFailure(immersivePreferences.code);
    }
  }, [immersivePreferences, reportFailure]);

  useEffect(() => {
    notifyContextMenuReadiness();
  }, [immersive, notifyContextMenuReadiness]);

  const enterImmersive = useCallback(() => {
    closeForToolbar();
    toolbarSessionRef.current?.closePopovers();
    restoreImmersiveFocusRef.current = true;
    const preferences = immersivePreferencesPort.read();
    setImmersivePreferences(preferences);
    setEditorStatusState((currentState) => ({
      focused: false,
      status:
        'local-draft' === currentState.status?.owner
        && 'error' !== currentState.status.type
          ? null
          : currentState.status
    }));
    captureLayoutScrollRestore();
    immersiveRef.current = true;
    setImmersive(true);
  }, [
    captureLayoutScrollRestore,
    closeForToolbar,
    immersivePreferencesPort,
    immersiveRef,
    setEditorStatusState,
    setImmersive,
    toolbarSessionRef
  ]);

  const exitImmersive = useCallback(() => {
    const generation = ++immersiveModeRequestRef.current;
    deferredImmersiveModeRef.current = null;
    cancelVisualUnlockPreparation();
    if (
      !visualPreviewEditingRef.current
      && !visualPreviewWindowRequestedRef.current
    ) {
      captureLayoutScrollRestore();
      immersiveRef.current = false;
      setImmersive(false);
      return;
    }
    if (visualPreviewPendingRef.current) {
      deferredImmersiveModeRef.current = { generation, mode: null };
      return;
    }
    // Exiting immersive mode is a user CANCELLATION of visual preview: the
    // accepted source is already what the canonical document holds, so
    // re-rendering it here would issue a session render for a demand the user
    // just abandoned. Teardown therefore suppresses the leave-time refresh; a
    // not-ready surface is also acceptable, so materialize is skipped.
    void prepareSourceMutationWithPreview({
      isCurrent: () =>
        generation === immersiveModeRequestRef.current
        && rootActiveRef.current
        && immersiveRef.current,
      materialize: false,
      suppressRefresh: true
    }).then((prepared) => {
      const current =
        generation === immersiveModeRequestRef.current
        && rootActiveRef.current
        && immersiveRef.current;
      if (!prepared || !current) {
        if (
          !prepared
          && current
          && visualPreviewPendingRef.current
          && !deferredImmersiveModeRef.current
        ) {
          deferredImmersiveModeRef.current = { generation, mode: null };
        }
        return;
      }
      captureLayoutScrollRestore();
      immersiveRef.current = false;
      setImmersive(false);
    });
  }, [
    cancelVisualUnlockPreparation,
    captureLayoutScrollRestore,
    immersiveRef,
    prepareSourceMutationWithPreview,
    rootActiveRef,
    setImmersive,
    visualPreviewEditingRef,
    visualPreviewPendingRef,
    visualPreviewWindowRequestedRef
  ]);

  const changeImmersiveMode = useCallback(
    (mode: ImmersiveViewMode) => {
      // Every explicit view choice is a new request identity and supersedes any
      // preparation or deferred request that started before it, including
      // choosing the current mode again (a deliberate cancel).
      const generation = ++immersiveModeRequestRef.current;
      deferredImmersiveModeRef.current = null;
      if (mode === immersiveModeRef.current) return;
      cancelVisualUnlockPreparation();
      if (
        !visualPreviewEditingRef.current
        && !visualPreviewWindowRequestedRef.current
      ) {
        captureLayoutScrollRestore();
        setImmersiveMode(mode);
        return;
      }
      // The surface's toolbar fallback refuses by design while a formal
      // transfer is outstanding. That refusal is kept; the request waits for
      // the transfer instead of being dropped, and nothing is bypassed.
      if (visualPreviewPendingRef.current) {
        deferredImmersiveModeRef.current = { generation, mode };
        return;
      }
      void prepareSourceMutationWithPreview({
        isCurrent: () =>
          generation === immersiveModeRequestRef.current
          && rootActiveRef.current
          && immersiveRef.current
      }).then((prepared) => {
        if (!prepared || !rootActiveRef.current || !immersiveRef.current)
          return;
        // An older request must not commit after a newer explicit choice, even
        // when its preparation has already passed every internal await.
        if (generation !== immersiveModeRequestRef.current) return;
        captureLayoutScrollRestore();
        setImmersiveMode(mode);
      });
    },
    [
      cancelVisualUnlockPreparation,
      captureLayoutScrollRestore,
      immersiveModeRef,
      immersiveRef,
      prepareSourceMutationWithPreview,
      rootActiveRef,
      setImmersiveMode,
      visualPreviewEditingRef,
      visualPreviewPendingRef,
      visualPreviewWindowRequestedRef
    ]
  );

  // Run a deferred view request through the same safe preparation once its
  // formal transfer has settled. The guards below are the same ones the direct
  // path relies on; this adds no retry loop, timeout or second coordinator.
  useEffect(() => {
    if (visualPreviewPending) return;
    const request = deferredImmersiveModeRef.current;
    if (!request) return;
    deferredImmersiveModeRef.current = null;
    if (!rootActiveRef.current || !immersiveRef.current) return;
    if (request.generation !== immersiveModeRequestRef.current) return;
    if (null !== request.mode && request.mode === immersiveModeRef.current)
      return;
    cancelVisualUnlockPreparation();
    if (
      !visualPreviewEditingRef.current
      && !visualPreviewWindowRequestedRef.current
    ) {
      captureLayoutScrollRestore();
      if (null === request.mode) {
        immersiveRef.current = false;
        setImmersive(false);
      } else {
        setImmersiveMode(request.mode);
      }
      return;
    }
    void prepareSourceMutationWithPreview({
      ...(null === request.mode
        ? { materialize: false, suppressRefresh: true }
        : {}),
      isCurrent: () =>
        request.generation === immersiveModeRequestRef.current
        && rootActiveRef.current
        && immersiveRef.current
    }).then((prepared) => {
      const current =
        rootActiveRef.current
        && immersiveRef.current
        && request.generation === immersiveModeRequestRef.current
        && (null === request.mode || request.mode !== immersiveModeRef.current);
      if (!prepared || !current) {
        // A newer transfer started before the preparation could run: wait for
        // that one as the same request, then try the same safe path again. A
        // superseded request is dropped by the generation check.
        if (
          !prepared
          && current
          && visualPreviewPendingRef.current
          && !deferredImmersiveModeRef.current
        ) {
          deferredImmersiveModeRef.current = request;
        }
        return;
      }
      if (deferredImmersiveModeRef.current) return;
      captureLayoutScrollRestore();
      if (null === request.mode) {
        immersiveRef.current = false;
        setImmersive(false);
      } else {
        setImmersiveMode(request.mode);
      }
    });
  }, [
    cancelVisualUnlockPreparation,
    captureLayoutScrollRestore,
    immersiveModeRef,
    immersiveRef,
    prepareSourceMutationWithPreview,
    rootActiveRef,
    setImmersive,
    setImmersiveMode,
    visualPreviewEditingRef,
    visualPreviewPending,
    visualPreviewPendingRef,
    visualPreviewWindowRequestedRef
  ]);

  useEffect(() => {
    if (immersive || !restoreImmersiveFocusRef.current) return;
    restoreImmersiveFocusRef.current = false;
    immersiveToggleRef.current?.focus();
  }, [immersive]);

  useLayoutEffect(() => {
    if (!immersive || !documentSession || !rootRef.current) return;
    const releaseFocusBoundary = immersiveEnvironment.activateFocusBoundary(
      rootRef.current
    );
    documentSession.document.focus();
    return releaseFocusBoundary;
  }, [documentSession, immersive, immersiveEnvironment, rootRef]);

  useEffect(() => {
    const previewRuntime = previewRuntimeRef.current;
    if (!documentSession || !previewRuntime || !scrollSyncEnabled) {
      return;
    }
    const binding = scrollSyncPort.prepareBinding({
      preview: previewScrollCanvas(previewRuntime.surface),
      source: documentSession.document.getScrollElement()
    });
    binding.activate();
    return () => binding.dispose();
  }, [
    documentSession,
    immersive,
    immersiveMode,
    previewRuntimeGeneration,
    previewRuntimeRef,
    scrollSyncEnabled,
    scrollSyncPort
  ]);

  return {
    changeImmersiveMode,
    enterImmersive,
    exitImmersive,
    immersiveLayoutClass,
    immersivePreferences,
    immersiveToggleRef
  };
}
