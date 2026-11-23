import { flushSync, useCallback, useEffect } from '@wordpress/element';

import type { AppearanceState } from '../../contracts/bootstrap/appearance-bootstrap';
import type { EditorDocumentSession } from '../../features/document-source/ui/EditorDocumentSource';
import type { ImmersiveViewMode } from '../../features/immersive-editor/immersive-editor';
import {
  type PreparedCodeTheme,
  type PreviewEnhancementPort,
  previewEnhancementFailureCode
} from '../../features/live-preview/ports/preview-enhancement-port';
import type { PreviewSurfaceStatus } from '../../features/live-preview/ui/PreviewSurfaceOwner';
import { preloadImmersiveVisualEditor } from './ImmersiveVisualEditorHost';
import type {
  CodeThemePreparation,
  ImmersiveVisualEditorRuntime,
  LayoutScrollRestoreEntry,
  SharedRef
} from './editor-root-types';

export type UseEditorVisualUnlockOptions = Readonly<{
  cancelWechatBackgroundPreparation: () => void;
  codeThemePreparationGenerationRef: SharedRef<number>;
  codeThemePreparationRef: SharedRef<CodeThemePreparation | null>;
  documentSession: EditorDocumentSession | null;
  enhancementPort: PreviewEnhancementPort;
  hasUnsyncedVisualChanges: () => boolean;
  immersiveModeRef: SharedRef<ImmersiveViewMode>;
  immersiveRef: SharedRef<boolean>;
  lastVisualFailureRef: SharedRef<string | null>;
  layoutScrollRestoreRef: SharedRef<LayoutScrollRestoreEntry | null>;
  leaveVisualPreviewRef: SharedRef<
    (options?: Readonly<{ suppressRefresh?: boolean }>) => boolean
  >;
  previewAppearanceRef: SharedRef<AppearanceState>;
  previewRefreshPendingRef: SharedRef<boolean>;
  previewSurfaceStatusRef: SharedRef<PreviewSurfaceStatus>;
  reportFailure: (code: string) => void;
  rootActiveRef: SharedRef<boolean>;
  setImmersiveMode: (mode: ImmersiveViewMode) => void;
  setPreviewRefreshRevision: (updater: (revision: number) => number) => void;
  setVisualPreviewChanged: (changed: boolean) => void;
  setVisualPreviewEditing: (editing: boolean) => void;
  setVisualPreviewPending: (pending: boolean) => void;
  setVisualPreviewUnlocking: (unlocking: boolean) => void;
  visualEditorRuntimeRef: SharedRef<ImmersiveVisualEditorRuntime | null>;
  visualPreviewChangedRef: SharedRef<boolean>;
  visualPreviewEditingRef: SharedRef<boolean>;
  visualPreviewLockingRef: SharedRef<boolean>;
}>;

export function useEditorVisualUnlock({
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
  previewAppearanceRef,
  previewRefreshPendingRef,
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
  visualPreviewLockingRef
}: UseEditorVisualUnlockOptions) {
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
        suppressRefresh?: boolean;
      }> = {}
    ) => {
      if (!visualPreviewEditingRef.current) {
        return false;
      }
      const needsRefresh =
        !options.suppressRefresh && hasUnsyncedVisualChanges();
      lastVisualFailureRef.current = null;
      visualPreviewEditingRef.current = false;
      visualPreviewChangedRef.current = false;
      setVisualPreviewEditing(false);
      setVisualPreviewUnlocking(false);
      setVisualPreviewPending(false);
      setVisualPreviewChanged(false);
      if (needsRefresh) {
        previewRefreshPendingRef.current = true;
        setPreviewRefreshRevision((revision) => revision + 1);
      }
      return true;
    },
    [
      hasUnsyncedVisualChanges,
      lastVisualFailureRef,
      previewRefreshPendingRef,
      setPreviewRefreshRevision,
      setVisualPreviewChanged,
      setVisualPreviewEditing,
      setVisualPreviewPending,
      setVisualPreviewUnlocking,
      visualPreviewChangedRef,
      visualPreviewEditingRef
    ]
  );
  leaveVisualPreviewRef.current = leaveVisualPreview;

  const requestVisualPreviewUnlock = useCallback(() => {
    if (
      !rootActiveRef.current
      || !immersiveRef.current
      || 'preview' !== immersiveModeRef.current
      || 'error' === previewSurfaceStatusRef.current
      || visualPreviewEditingRef.current
      || codeThemePreparationRef.current
      || !documentSession
    ) {
      return;
    }
    flushSync(() => setVisualPreviewUnlocking(true));
    const sourceMarkdown = documentSession.document.getValue();
    const enableVisualPreview = () => {
      visualPreviewChangedRef.current = false;
      setVisualPreviewChanged(false);
      setVisualPreviewPending(false);
      setVisualPreviewUnlocking(false);
      visualPreviewEditingRef.current = true;
      setVisualPreviewEditing(true);
    };

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
      && 'error' !== previewSurfaceStatusRef.current
      && !visualPreviewEditingRef.current
      && documentSession.document.getValue() === sourceMarkdown;

    const clearPreparation = () => {
      unsubscribeSource();
      if (codeThemePreparationRef.current === preparation) {
        codeThemePreparationRef.current = null;
      }
    };

    const unsubscribeSource = documentSession.document.subscribe(() => {
      if (
        codeThemePreparationRef.current === preparation
        && documentSession.document.getValue() !== sourceMarkdown
      ) {
        controller.abort();
        preparation.prepared?.cancel();
        clearPreparation();
        if (rootActiveRef.current) setVisualPreviewUnlocking(false);
      }
    });
    controller.signal.addEventListener('abort', unsubscribeSource, {
      once: true
    });

    void (async () => {
      let prepared: PreparedCodeTheme | null = null;
      try {
        const codeThemePromise = enhancementPort
          .prepareCodeTheme({
            codeTheme: previewAppearanceRef.current.codeTheme,
            signal: controller.signal
          })
          .then((result) => {
            prepared = result;
            return result;
          });
        const chunkPromise = preloadImmersiveVisualEditor().catch(() => {
          throw new Error('visual-editor-load-failed');
        });
        await Promise.all([codeThemePromise, chunkPromise]);
      } catch (error: unknown) {
        (prepared as PreparedCodeTheme | null)?.cancel();
        const current = isCurrent();
        clearPreparation();
        if (current) {
          setVisualPreviewUnlocking(false);
          reportFailure(
            error instanceof Error
              && 'visual-editor-load-failed' === error.message
              ? 'visual-editor-load-failed'
              : previewEnhancementFailureCode(error)
          );
        }
        return;
      }
      if (!prepared) {
        clearPreparation();
        if (isCurrent()) {
          setVisualPreviewUnlocking(false);
          reportFailure('preview-enhancement-failed');
        }
        return;
      }
      const readyTheme: PreparedCodeTheme = prepared;
      preparation.prepared = readyTheme;
      if (!isCurrent()) {
        readyTheme.cancel();
        clearPreparation();
        return;
      }
      try {
        readyTheme.commit();
      } catch (error: unknown) {
        const current = isCurrent();
        readyTheme.cancel();
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
    setVisualPreviewChanged,
    setVisualPreviewEditing,
    setVisualPreviewPending,
    setVisualPreviewUnlocking,
    visualPreviewChangedRef,
    visualPreviewEditingRef
  ]);

  const prepareVisualSource = useCallback(() => {
    if (!visualPreviewEditingRef.current) {
      cancelVisualUnlockPreparation();
      return true;
    }
    const runtime = visualEditorRuntimeRef.current;
    if (!runtime) return true;
    return runtime.prepareToolbarFallback();
  }, [
    cancelVisualUnlockPreparation,
    visualEditorRuntimeRef,
    visualPreviewEditingRef
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

  const prepareSourceMutationWithPreview = useCallback(
    async (
      options: Readonly<{
        requireSync?: boolean;
        suppressRefresh?: boolean;
        isCurrent?: () => boolean;
      }> = {}
    ) => {
      if (!visualPreviewEditingRef.current) {
        return true;
      }
      if (false !== options.requireSync || visualPreviewChangedRef.current) {
        if (!prepareVisualSource()) return false;
      }
      if (options.isCurrent && !options.isCurrent()) {
        return false;
      }
      const leaveOptions: Readonly<{ suppressRefresh?: boolean }> =
        true === options.suppressRefresh ? { suppressRefresh: true } : {};
      visualPreviewLockingRef.current = false;
      leaveVisualPreview(leaveOptions);
      return true;
    },
    [
      leaveVisualPreview,
      prepareVisualSource,
      visualPreviewChangedRef,
      visualPreviewEditingRef,
      visualPreviewLockingRef
    ]
  );

  useEffect(
    () => () => {
      visualPreviewLockingRef.current = false;
    },
    [visualPreviewLockingRef]
  );

  return {
    cancelVisualUnlockPreparation,
    leaveVisualPreview,
    prepareGeneratedSourceNavigation,
    prepareSourceMutation,
    prepareSourceMutationWithPreview,
    prepareVisualSource,
    requestVisualPreviewUnlock
  };
}
