import { useCallback, useEffect, useRef } from '@wordpress/element';

import type { ImmersiveEnvironmentPort } from '../../contracts/ports/immersive-environment-port';
import type { WechatClipboardPort } from '../../contracts/ports/wechat-clipboard-port';
import type { ImmersiveViewMode } from '../../features/immersive-editor/immersive-editor';
import type {
  PreviewSurfaceRuntime,
  PreviewSurfaceStatus
} from '../../features/live-preview/ui/PreviewSurfaceOwner';
import { WECHAT_PREPARATION_DEBOUNCE_MS } from './editor-root-helpers';
import type {
  ImmersiveVisualEditorRuntime,
  SharedRef
} from './editor-root-types';

export type UseEditorWechatPreparationOptions = Readonly<{
  immersive: boolean;
  immersiveEnvironment: ImmersiveEnvironmentPort;
  immersiveMode: ImmersiveViewMode;
  previewRuntimeGeneration: number;
  previewRuntimeRef: SharedRef<PreviewSurfaceRuntime | null>;
  previewSurfaceStatusRef: SharedRef<PreviewSurfaceStatus>;
  rootActiveRef: SharedRef<boolean>;
  visualEditorRuntimeRef: SharedRef<ImmersiveVisualEditorRuntime | null>;
  visualPreviewEditingRef: SharedRef<boolean>;
  visualPreviewLockingRef: SharedRef<boolean>;
  visualPreviewUnlockingRef: SharedRef<boolean>;
  wechatClipboard: WechatClipboardPort;
  wechatCopyPendingRef: SharedRef<boolean>;
  wechatExportEnabled: boolean;
  wechatPngConversionEnabled: boolean;
}>;

export function useEditorWechatPreparation({
  immersive,
  immersiveEnvironment,
  immersiveMode,
  previewRuntimeGeneration,
  previewRuntimeRef,
  previewSurfaceStatusRef,
  rootActiveRef,
  visualEditorRuntimeRef,
  visualPreviewEditingRef,
  visualPreviewLockingRef,
  visualPreviewUnlockingRef,
  wechatClipboard,
  wechatCopyPendingRef,
  wechatExportEnabled,
  wechatPngConversionEnabled
}: UseEditorWechatPreparationOptions) {
  const scheduledWechatPreparationRef = useRef<(() => void) | null>(null);
  const wechatBackgroundPreparationRef = useRef<{
    controller: AbortController;
    inFlight: number;
  } | null>(null);
  const previousWechatLayoutRef = useRef({ immersive, mode: immersiveMode });

  const rememberWechatPreviewWidth = useCallback(
    (surface?: HTMLElement | null) => {
      if (!wechatExportEnabled) return;
      const remember = wechatClipboard.rememberPreviewWidth;
      if (!remember) return;
      const visualSurface = visualPreviewEditingRef.current
        ? visualEditorRuntimeRef.current?.surface
        : null;
      const activePreview =
        surface
        ?? (visualSurface?.isConnected ? visualSurface : null)
        ?? previewRuntimeRef.current?.surface
        ?? null;
      if (activePreview) remember(activePreview);
    },
    [
      previewRuntimeRef,
      visualEditorRuntimeRef,
      visualPreviewEditingRef,
      wechatClipboard,
      wechatExportEnabled
    ]
  );

  const clearScheduledWechatPreparation = useCallback(() => {
    scheduledWechatPreparationRef.current?.();
    scheduledWechatPreparationRef.current = null;
  }, []);

  const cancelWechatBackgroundPreparation = useCallback(() => {
    clearScheduledWechatPreparation();
    const preparation = wechatBackgroundPreparationRef.current;
    wechatBackgroundPreparationRef.current = null;
    preparation?.controller.abort();
    const releasePrepared = wechatClipboard.releasePrepared;
    const preview = previewRuntimeRef.current?.surface;
    const visual = visualEditorRuntimeRef.current?.surface;
    if (preview) releasePrepared?.(preview);
    if (visual && visual !== preview) releasePrepared?.(visual);
  }, [
    clearScheduledWechatPreparation,
    previewRuntimeRef,
    visualEditorRuntimeRef,
    wechatClipboard
  ]);

  const prepareWechatPreview = useCallback(
    (surface: HTMLElement | null) => {
      const prepare = wechatClipboard.prepare;
      if (
        !rootActiveRef.current
        || wechatCopyPendingRef.current
        || visualPreviewEditingRef.current
        || visualPreviewUnlockingRef.current
        || visualPreviewLockingRef.current
        || 'ready' !== previewSurfaceStatusRef.current
        || !wechatExportEnabled
        || !surface
        || !prepare
      )
        return;
      let preparation = wechatBackgroundPreparationRef.current;
      if (!preparation) {
        preparation = { controller: new AbortController(), inFlight: 0 };
        wechatBackgroundPreparationRef.current = preparation;
      }
      if (preparation.controller.signal.aborted) return;
      // Preparation runs in the background so the compatibility copy path is
      // ready when requested. Its result is reported by the actual copy
      // operation; opening or editing a Preview is not a copy failure.
      const currentPreparation = preparation;
      const geometryOnly = wechatPngConversionEnabled;
      currentPreparation.inFlight += 1;
      let task: Promise<void>;
      try {
        task = Promise.resolve(
          prepare(surface, {
            background: true,
            ...(geometryOnly ? { geometryOnly: true } : {}),
            signal: currentPreparation.controller.signal
          })
        );
      } catch {
        currentPreparation.inFlight = Math.max(
          0,
          currentPreparation.inFlight - 1
        );
        if (
          !geometryOnly
          && wechatBackgroundPreparationRef.current === currentPreparation
          && 0 === currentPreparation.inFlight
        ) {
          wechatBackgroundPreparationRef.current = null;
        }
        return;
      }
      void task
        .catch(() => undefined)
        .finally(() => {
          currentPreparation.inFlight = Math.max(
            0,
            currentPreparation.inFlight - 1
          );
          // Geometry-only preparation retains its owner controller so a later
          // theme or Preview disposal can abort and clean the cached lease.
          if (wechatBackgroundPreparationRef.current !== currentPreparation) {
            return;
          }
          if (!geometryOnly && 0 === currentPreparation.inFlight) {
            wechatBackgroundPreparationRef.current = null;
          }
        });
    },
    [
      previewSurfaceStatusRef,
      rootActiveRef,
      visualPreviewEditingRef,
      visualPreviewLockingRef,
      visualPreviewUnlockingRef,
      wechatClipboard,
      wechatCopyPendingRef,
      wechatExportEnabled,
      wechatPngConversionEnabled
    ]
  );

  const scheduleWechatPreviewPreparation = useCallback(
    (surface: HTMLElement | null) => {
      const prepare = wechatClipboard.prepare;
      if (!wechatExportEnabled || !surface || !prepare) return;
      if (wechatCopyPendingRef.current) {
        clearScheduledWechatPreparation();
        return;
      }
      if (wechatPngConversionEnabled) {
        rememberWechatPreviewWidth(surface);
      }
      clearScheduledWechatPreparation();
      const cancel = immersiveEnvironment.schedule(() => {
        scheduledWechatPreparationRef.current = null;
        prepareWechatPreview(surface);
      }, WECHAT_PREPARATION_DEBOUNCE_MS);
      scheduledWechatPreparationRef.current = cancel;
    },
    [
      clearScheduledWechatPreparation,
      immersiveEnvironment,
      prepareWechatPreview,
      rememberWechatPreviewWidth,
      wechatClipboard,
      wechatCopyPendingRef,
      wechatExportEnabled,
      wechatPngConversionEnabled
    ]
  );

  const scheduleCurrentWechatPreviewPreparation = useCallback(() => {
    if (visualPreviewEditingRef.current) return;
    scheduleWechatPreviewPreparation(
      previewRuntimeRef.current?.surface ?? null
    );
  }, [
    previewRuntimeRef,
    scheduleWechatPreviewPreparation,
    visualPreviewEditingRef
  ]);

  useEffect(() => {
    if (!wechatExportEnabled || !wechatClipboard.prepare) {
      return undefined;
    }
    const unsubscribe = immersiveEnvironment.subscribeResize(
      scheduleCurrentWechatPreviewPreparation
    );
    return unsubscribe;
  }, [
    immersiveEnvironment,
    scheduleCurrentWechatPreviewPreparation,
    wechatClipboard,
    wechatExportEnabled,
    wechatPngConversionEnabled
  ]);

  useEffect(() => {
    if (!wechatExportEnabled || !wechatClipboard.prepare) {
      return undefined;
    }
    const surface = previewRuntimeRef.current?.surface ?? null;
    if (!surface) return undefined;
    return immersiveEnvironment.observePreviewLayout(
      surface,
      scheduleCurrentWechatPreviewPreparation
    );
  }, [
    immersiveEnvironment,
    previewRuntimeGeneration,
    previewRuntimeRef,
    scheduleCurrentWechatPreviewPreparation,
    wechatClipboard,
    wechatExportEnabled,
    wechatPngConversionEnabled
  ]);

  useEffect(() => {
    const previous = previousWechatLayoutRef.current;
    if (previous.immersive === immersive && previous.mode === immersiveMode) {
      return;
    }
    previousWechatLayoutRef.current = { immersive, mode: immersiveMode };
    scheduleCurrentWechatPreviewPreparation();
  }, [immersive, immersiveMode, scheduleCurrentWechatPreviewPreparation]);

  useEffect(() => {
    scheduleCurrentWechatPreviewPreparation();
  }, [
    scheduleCurrentWechatPreviewPreparation,
    wechatClipboard,
    wechatExportEnabled,
    wechatPngConversionEnabled
  ]);

  useEffect(
    () => () => cancelWechatBackgroundPreparation(),
    [
      cancelWechatBackgroundPreparation,
      wechatClipboard,
      wechatExportEnabled,
      wechatPngConversionEnabled
    ]
  );

  return {
    cancelWechatBackgroundPreparation,
    clearScheduledWechatPreparation,
    rememberWechatPreviewWidth,
    scheduleCurrentWechatPreviewPreparation,
    scheduleWechatPreviewPreparation
  };
}
