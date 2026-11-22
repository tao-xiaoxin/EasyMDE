import { flushSync, useCallback, useEffect } from '@wordpress/element';

import type { AppearanceState } from '../../contracts/bootstrap/appearance-bootstrap';
import type { EditorDocumentSession } from '../../features/document-source/ui/EditorDocumentSource';
import type { ImmersiveViewMode } from '../../features/immersive-editor/immersive-editor';
import { DEFAULT_PREVIEW_WINDOW_MAX_MOUNTED } from '../../features/live-preview/model/preview-window-model';
import {
  type PreparedCodeTheme,
  type PreviewEnhancementPort,
  previewEnhancementFailureCode
} from '../../features/live-preview/ports/preview-enhancement-port';
import type {
  PreviewAcceptedWindowSnapshot,
  PreviewSurfaceRuntime,
  PreviewSurfaceStatus
} from '../../features/live-preview/ui/PreviewSurfaceOwner';
import {
  isVisualPreviewWindowRequestCurrent,
  visualPreviewSourceHasEditableMap
} from './editor-root-helpers';
import type {
  CodeThemePreparation,
  EditorVisualPreviewSnapshot,
  ImmersiveVisualEditorRuntime,
  LayoutScrollRestoreEntry,
  SharedRef,
  VisualPreviewWindowRequest
} from './editor-root-types';

export type UseEditorVisualUnlockOptions = Readonly<{
  acceptedWindowSnapshotKeyRef: SharedRef<number | null>;
  cancelWechatBackgroundPreparation: () => void;
  codeThemePreparationGenerationRef: SharedRef<number>;
  codeThemePreparationRef: SharedRef<CodeThemePreparation | null>;
  documentSession: EditorDocumentSession | null;
  enhancementPort: PreviewEnhancementPort;
  getAcceptedWindowSnapshot: () => PreviewAcceptedWindowSnapshot | null;
  immersiveModeRef: SharedRef<ImmersiveViewMode>;
  immersiveRef: SharedRef<boolean>;
  lastVisualFailureRef: SharedRef<string | null>;
  layoutScrollRestoreRef: SharedRef<LayoutScrollRestoreEntry | null>;
  leaveVisualPreviewRef: SharedRef<
    (options?: Readonly<{ suppressRefresh?: boolean }>) => boolean
  >;
  notifyContextMenuReadiness: () => void;
  previewAppearanceRef: SharedRef<AppearanceState>;
  previewRefreshPendingRef: SharedRef<boolean>;
  previewRuntimeRef: SharedRef<PreviewSurfaceRuntime | null>;
  previewSurfaceStatusRef: SharedRef<PreviewSurfaceStatus>;
  reportFailure: (code: string) => void;
  rootActiveRef: SharedRef<boolean>;
  setAcceptedWindowSnapshotGeneration: (
    updater: (generation: number) => number
  ) => void;
  setImmersiveMode: (mode: ImmersiveViewMode) => void;
  setPreviewRefreshRevision: (updater: (revision: number) => number) => void;
  setPreviewSurfaceStatus: (status: PreviewSurfaceStatus) => void;
  setVisualDocumentEndHistoryPending: (pending: boolean) => void;
  setVisualPreviewChanged: (changed: boolean) => void;
  setVisualPreviewEditing: (editing: boolean) => void;
  setVisualPreviewPending: (pending: boolean) => void;
  setVisualPreviewUnlocking: (unlocking: boolean) => void;
  setVisualPreviewWindowRequested: (requested: boolean) => void;
  setVisualResumeCanonicalToken: (updater: (token: number) => number) => void;
  setVisualWindowedHistoryBranchHeld: (held: boolean) => void;
  visualDocumentEndHistoryPendingRef: SharedRef<boolean>;
  visualEditorRuntimeRef: SharedRef<ImmersiveVisualEditorRuntime | null>;
  visualPreviewEditingRef: SharedRef<boolean>;
  visualPreviewHoldOwnerRef: SharedRef<object | null>;
  visualPreviewLeftEditingRef: SharedRef<boolean>;
  visualPreviewLockingRef: SharedRef<boolean>;
  visualPreviewNeedsWindow: boolean;
  visualPreviewSnapshotRef: SharedRef<EditorVisualPreviewSnapshot | null>;
  visualPreviewWindowRequestedRef: SharedRef<boolean>;
  visualPreviewWindowUnlockRef: SharedRef<VisualPreviewWindowRequest | null>;
}>;

export function useEditorVisualUnlock({
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
}: UseEditorVisualUnlockOptions) {
  const cancelVisualPreviewWindowUnlock = useCallback(() => {
    if (!visualPreviewWindowUnlockRef.current) return;
    visualPreviewWindowUnlockRef.current = null;
    visualPreviewWindowRequestedRef.current = false;
    if (rootActiveRef.current) {
      setVisualPreviewWindowRequested(false);
      setVisualPreviewUnlocking(false);
    }
  }, [
    rootActiveRef,
    setVisualPreviewUnlocking,
    setVisualPreviewWindowRequested,
    visualPreviewWindowRequestedRef,
    visualPreviewWindowUnlockRef
  ]);

  const cancelVisualUnlockPreparation = useCallback(() => {
    const preparation = codeThemePreparationRef.current;
    if ('visual-unlock' !== preparation?.owner) return;
    preparation.controller.abort();
    preparation.prepared?.cancel();
    codeThemePreparationRef.current = null;
    if (rootActiveRef.current) setVisualPreviewUnlocking(false);
  }, [codeThemePreparationRef, rootActiveRef, setVisualPreviewUnlocking]);

  const leaveVisualPreview = useCallback(
    (
      options: Readonly<{
        /**
         * The transfer failed terminally, so the accepted Preview for this
         * source is already known to be unavailable. Scheduling the usual
         * leave refresh would immediately re-request the exact markdown whose
         * refresh just failed - an automatic retry of a protected mutation,
         * which the contract forbids. Every other exit reason keeps the normal
         * refresh.
         */
        suppressRefresh?: boolean;
      }> = {}
    ) => {
      if (
        !visualPreviewEditingRef.current
        && !visualPreviewWindowRequestedRef.current
      )
        return false;
      lastVisualFailureRef.current = null;
      visualPreviewLeftEditingRef.current =
        visualPreviewEditingRef.current
        || visualPreviewWindowRequestedRef.current;
      visualPreviewWindowRequestedRef.current = false;
      setVisualPreviewWindowRequested(false);
      visualPreviewEditingRef.current = false;
      setVisualPreviewEditing(false);
      setVisualPreviewUnlocking(false);
      setVisualPreviewPending(false);
      visualDocumentEndHistoryPendingRef.current = false;
      setVisualDocumentEndHistoryPending(false);
      setVisualWindowedHistoryBranchHeld(false);
      setVisualPreviewChanged(false);
      if (!options.suppressRefresh) {
        previewRefreshPendingRef.current = true;
        setPreviewRefreshRevision((revision) => revision + 1);
      }
      return true;
    },
    [
      lastVisualFailureRef,
      previewRefreshPendingRef,
      setPreviewRefreshRevision,
      setVisualDocumentEndHistoryPending,
      setVisualPreviewChanged,
      setVisualPreviewEditing,
      setVisualPreviewPending,
      setVisualPreviewUnlocking,
      setVisualPreviewWindowRequested,
      setVisualWindowedHistoryBranchHeld,
      visualDocumentEndHistoryPendingRef,
      visualPreviewEditingRef,
      visualPreviewLeftEditingRef,
      visualPreviewWindowRequestedRef
    ]
  );
  leaveVisualPreviewRef.current = leaveVisualPreview;

  const handlePreviewWindowReady = useCallback(() => {
    const accepted = getAcceptedWindowSnapshot();
    if (accepted && accepted.key !== acceptedWindowSnapshotKeyRef.current) {
      acceptedWindowSnapshotKeyRef.current = accepted.key;
      setAcceptedWindowSnapshotGeneration((generation) => generation + 1);
    }
    notifyContextMenuReadiness();
    const request = visualPreviewWindowUnlockRef.current;
    const snapshot = visualPreviewSnapshotRef.current;
    if (
      !rootActiveRef.current
      || visualPreviewLockingRef.current
      || !visualPreviewWindowRequestedRef.current
      || !request
    )
      return;
    if (
      !isVisualPreviewWindowRequestCurrent(
        request,
        snapshot,
        previewSurfaceStatusRef.current,
        rootActiveRef.current
      )
    ) {
      cancelVisualPreviewWindowUnlock();
      return;
    }
    cancelVisualPreviewWindowUnlock();
    cancelWechatBackgroundPreparation();
    visualPreviewEditingRef.current = true;
    setVisualPreviewEditing(true);
  }, [
    acceptedWindowSnapshotKeyRef,
    cancelVisualPreviewWindowUnlock,
    cancelWechatBackgroundPreparation,
    getAcceptedWindowSnapshot,
    notifyContextMenuReadiness,
    previewSurfaceStatusRef,
    rootActiveRef,
    setAcceptedWindowSnapshotGeneration,
    setVisualPreviewEditing,
    visualPreviewEditingRef,
    visualPreviewLockingRef,
    visualPreviewSnapshotRef,
    visualPreviewWindowRequestedRef,
    visualPreviewWindowUnlockRef
  ]);

  const requestVisualPreviewUnlock = useCallback(() => {
    const snapshot = visualPreviewSnapshotRef.current;
    if (
      !rootActiveRef.current
      || !immersiveRef.current
      || 'preview' !== immersiveModeRef.current
      || 'ready' !== previewSurfaceStatusRef.current
      || visualPreviewEditingRef.current
      || visualPreviewWindowRequestedRef.current
      || codeThemePreparationRef.current
      || !snapshot
      || !documentSession
    )
      return;
    const hasEditableMap = visualPreviewSourceHasEditableMap(
      snapshot,
      documentSession.document.getValue()
    );
    if (!hasEditableMap) return;
    flushSync(() => setVisualPreviewUnlocking(true));
    const snapshotRevision = snapshot.revision;
    const snapshotSignature = snapshot.signature;
    const sourceMarkdown = documentSession.document.getValue();
    const windowed =
      (snapshot.editMap?.blocks.length ?? 0)
      > DEFAULT_PREVIEW_WINDOW_MAX_MOUNTED;
    const enableVisualPreview = () => {
      if (visualPreviewLeftEditingRef.current) {
        visualPreviewLeftEditingRef.current = false;
        setVisualResumeCanonicalToken((token) => token + 1);
      }
      setPreviewSurfaceStatus('ready');
      setVisualPreviewChanged(false);
      setVisualPreviewPending(false);
      if (windowed) {
        visualPreviewWindowUnlockRef.current = {
          revision: snapshotRevision,
          signature: snapshotSignature
        };
        visualPreviewWindowRequestedRef.current = true;
        setVisualPreviewWindowRequested(true);
        return;
      }
      setVisualPreviewUnlocking(false);
      visualPreviewEditingRef.current = true;
      setVisualPreviewEditing(true);
    };
    // A code-free Preview does not load code resources. Prepare them before
    // handing the surface to local visual editing so its first PRE is framed
    // on the mutation that creates it, including in a non-empty document.
    const controller = new AbortController();
    const generation = ++codeThemePreparationGenerationRef.current;
    const preparation: CodeThemePreparation = {
      controller,
      generation,
      owner: 'visual-unlock',
      prepared: null,
      sourceMarkdown
    };
    codeThemePreparationRef.current = preparation;
    cancelWechatBackgroundPreparation();
    const isCurrent = () =>
      rootActiveRef.current
      && codeThemePreparationRef.current === preparation
      && !controller.signal.aborted
      && immersiveRef.current
      && 'preview' === immersiveModeRef.current
      && 'ready' === previewSurfaceStatusRef.current
      && !visualPreviewEditingRef.current
      && !visualPreviewWindowRequestedRef.current
      && visualPreviewSnapshotRef.current?.revision === snapshotRevision
      && visualPreviewSnapshotRef.current?.signature === snapshotSignature
      && documentSession.document.getValue() === sourceMarkdown;
    const clearPreparation = () => {
      if (codeThemePreparationRef.current === preparation) {
        codeThemePreparationRef.current = null;
      }
    };

    void (async () => {
      let prepared: PreparedCodeTheme;
      try {
        prepared = await enhancementPort.prepareCodeTheme({
          codeTheme: previewAppearanceRef.current.codeTheme,
          signal: controller.signal
        });
      } catch (error: unknown) {
        const current = isCurrent();
        clearPreparation();
        if (current) {
          setVisualPreviewUnlocking(false);
          reportFailure(previewEnhancementFailureCode(error));
        }
        return;
      }
      preparation.prepared = prepared;
      if (!isCurrent()) {
        prepared.cancel();
        clearPreparation();
        return;
      }
      try {
        prepared.commit();
      } catch (error: unknown) {
        const current = isCurrent();
        prepared.cancel();
        clearPreparation();
        if (current) {
          setVisualPreviewUnlocking(false);
          reportFailure(previewEnhancementFailureCode(error));
        }
        return;
      }
      if (!isCurrent()) {
        clearPreparation();
        return;
      }
      clearPreparation();
      enableVisualPreview();
    })();
  }, [
    cancelWechatBackgroundPreparation,
    codeThemePreparationGenerationRef,
    codeThemePreparationRef,
    documentSession,
    enhancementPort,
    immersiveModeRef,
    immersiveRef,
    previewAppearanceRef,
    previewSurfaceStatusRef,
    reportFailure,
    rootActiveRef,
    setPreviewSurfaceStatus,
    setVisualPreviewChanged,
    setVisualPreviewEditing,
    setVisualPreviewPending,
    setVisualPreviewUnlocking,
    setVisualPreviewWindowRequested,
    setVisualResumeCanonicalToken,
    visualPreviewEditingRef,
    visualPreviewLeftEditingRef,
    visualPreviewSnapshotRef,
    visualPreviewWindowRequestedRef,
    visualPreviewWindowUnlockRef
  ]);

  const prepareVisualSource = useCallback(() => {
    if (
      !visualPreviewEditingRef.current
      && !visualPreviewWindowRequestedRef.current
    ) {
      cancelVisualUnlockPreparation();
      return true;
    }
    if (!visualPreviewEditingRef.current) return true;
    const runtime = visualEditorRuntimeRef.current;
    if (!runtime) throw new Error('visual-editor-runtime-unavailable');
    return runtime.prepareToolbarFallback();
  }, [
    cancelVisualUnlockPreparation,
    visualEditorRuntimeRef,
    visualPreviewEditingRef,
    visualPreviewWindowRequestedRef
  ]);

  const prepareSourceMutation = useCallback(() => {
    if (!prepareVisualSource()) return false;
    leaveVisualPreview();
    return true;
  }, [leaveVisualPreview, prepareVisualSource]);

  const prepareGeneratedSourceNavigation = useCallback(
    (
      expected: Readonly<{ revision: number; value: string }>,
      validateSource: () => boolean
    ) => {
      let prepared = false;
      flushSync(() => {
        const runtime = visualEditorRuntimeRef.current;
        if (!runtime) throw new Error('visual-editor-runtime-unavailable');
        prepared = runtime.prepareSourceNavigation(expected);
        if (!prepared || !validateSource()) {
          prepared = false;
          return;
        }
        leaveVisualPreview();
        if (immersiveRef.current && 'preview' === immersiveModeRef.current) {
          // Navigation owns its target viewport: a snapshot captured for the
          // layout being left must never be replayed over the newly revealed
          // source position.
          layoutScrollRestoreRef.current = null;
          setImmersiveMode('source');
        }
      });
      return prepared;
    },
    [
      immersiveModeRef,
      immersiveRef,
      layoutScrollRestoreRef,
      leaveVisualPreview,
      setImmersiveMode,
      visualEditorRuntimeRef
    ]
  );

  /**
   * Leave visual preview, materializing the full Preview surface first when the
   * caller genuinely needs the accepted window as its result (appearance apply,
   * custom CSS, WeChat export). A TEARDOWN caller - exiting immersive mode or
   * switching view - only needs the canonical source and a safe exit: a
   * not-ready surface is acceptable there, so it must not report a
   * materialization diagnostic nor abort its transition on a `false`.
   */
  const prepareSourceMutationWithPreview = useCallback(
    async (
      options: Readonly<{
        materialize?: boolean;
        suppressRefresh?: boolean;
        isCurrent?: () => boolean;
      }> = {}
    ) => {
      if (
        !visualPreviewEditingRef.current
        && !visualPreviewWindowRequestedRef.current
      )
        return true;
      if (!prepareVisualSource()) return false;
      const previewRuntime = previewRuntimeRef.current;
      if (!previewRuntime) throw new Error('preview-runtime-unavailable');
      const isCurrent = options.isCurrent;
      const requestOwner = {};
      // Undo only the state this exact request set. If a newer request already
      // owns the hold, this is a no-op: its preparation owns the release.
      const releaseOwnedHold = (): void => {
        if (visualPreviewHoldOwnerRef.current !== requestOwner) return;
        visualPreviewHoldOwnerRef.current = null;
        // A torn-down Root never restores editing or schedules state; it only
        // drops the ownership token it still held.
        if (!rootActiveRef.current) return;
        visualPreviewLockingRef.current = false;
        visualPreviewWindowUnlockRef.current = null;
        visualPreviewWindowRequestedRef.current = false;
        setVisualPreviewWindowRequested(false);
        // The held request itself made the surface non-editable while it waited;
        // a cancelled request restores the editing the user still had.
        visualPreviewEditingRef.current = true;
        setVisualPreviewEditing(true);
      };
      const holdWindow =
        visualPreviewEditingRef.current && visualPreviewNeedsWindow;
      if (holdWindow) {
        visualPreviewHoldOwnerRef.current = requestOwner;
        flushSync(() => {
          visualPreviewLockingRef.current = true;
          visualPreviewWindowUnlockRef.current = null;
          visualPreviewWindowRequestedRef.current = true;
          setVisualPreviewWindowRequested(true);
          visualPreviewEditingRef.current = false;
          setVisualPreviewEditing(false);
        });
        const previewWindow = previewRuntime.surface.ownerDocument.defaultView;
        await new Promise<void>((resolve) => {
          if (!previewWindow) {
            setTimeout(resolve, 0);
            return;
          }
          previewWindow.requestAnimationFrame(() => {
            previewWindow.requestAnimationFrame(() => resolve());
          });
        });
        if (isCurrent && !isCurrent()) {
          releaseOwnedHold();
          return false;
        }
      }
      const leaveOptions: Readonly<{ suppressRefresh?: boolean }> =
        true === options.suppressRefresh ? { suppressRefresh: true } : {};
      if (false !== options.materialize) {
        const materialized = await previewRuntime.materialize();
        if (isCurrent && !isCurrent()) {
          releaseOwnedHold();
          return false;
        }
        if (!materialized) {
          visualPreviewHoldOwnerRef.current = null;
          visualPreviewLockingRef.current = false;
          leaveVisualPreview(leaveOptions);
          return false;
        }
      }
      if (isCurrent && !isCurrent()) {
        releaseOwnedHold();
        return false;
      }
      visualPreviewHoldOwnerRef.current = null;
      visualPreviewLockingRef.current = false;
      leaveVisualPreview(leaveOptions);
      return true;
    },
    [
      leaveVisualPreview,
      prepareVisualSource,
      previewRuntimeRef,
      rootActiveRef,
      setVisualPreviewEditing,
      setVisualPreviewWindowRequested,
      visualPreviewEditingRef,
      visualPreviewHoldOwnerRef,
      visualPreviewLockingRef,
      visualPreviewNeedsWindow,
      visualPreviewWindowRequestedRef,
      visualPreviewWindowUnlockRef
    ]
  );

  useEffect(
    () => () => {
      visualPreviewHoldOwnerRef.current = null;
      visualPreviewWindowUnlockRef.current = null;
    },
    [visualPreviewHoldOwnerRef, visualPreviewWindowUnlockRef]
  );

  return {
    cancelVisualPreviewWindowUnlock,
    cancelVisualUnlockPreparation,
    handlePreviewWindowReady,
    leaveVisualPreview,
    prepareGeneratedSourceNavigation,
    prepareSourceMutation,
    prepareSourceMutationWithPreview,
    prepareVisualSource,
    requestVisualPreviewUnlock
  };
}
