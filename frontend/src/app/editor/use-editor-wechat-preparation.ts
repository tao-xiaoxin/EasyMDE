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
  visualEditorSurface: HTMLElement | null;
  visualPreviewEditingRef: SharedRef<boolean>;
  visualPreviewLockingRef: SharedRef<boolean>;
  visualPreviewUnlockingRef: SharedRef<boolean>;
  visualPreviewWindowRequestedRef: SharedRef<boolean>;
  wechatClipboard: WechatClipboardPort;
  wechatExportEnabled: boolean;
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
  visualEditorSurface,
  visualPreviewEditingRef,
  visualPreviewLockingRef,
  visualPreviewUnlockingRef,
  visualPreviewWindowRequestedRef,
  wechatClipboard,
  wechatExportEnabled
}: UseEditorWechatPreparationOptions) {
  const scheduledWechatPreparationRef = useRef<(() => void) | null>(null);
  const wechatBackgroundPreparationRef = useRef<{
    controller: AbortController;
  } | null>(null);
  const previousWechatLayoutRef = useRef({ immersive, mode: immersiveMode });

  const clearScheduledWechatPreparation = useCallback(() => {
    scheduledWechatPreparationRef.current?.();
    scheduledWechatPreparationRef.current = null;
  }, []);

  const cancelWechatBackgroundPreparation = useCallback(() => {
    clearScheduledWechatPreparation();
    const preparation = wechatBackgroundPreparationRef.current;
    wechatBackgroundPreparationRef.current = null;
    preparation?.controller.abort();
  }, [clearScheduledWechatPreparation]);

  const prepareWechatPreview = useCallback(
    (surface: HTMLElement | null) => {
      const prepare = wechatClipboard.prepare;
      if (
        !rootActiveRef.current
        || visualPreviewEditingRef.current
        || visualPreviewWindowRequestedRef.current
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
        preparation = { controller: new AbortController() };
        wechatBackgroundPreparationRef.current = preparation;
      }
      if (preparation.controller.signal.aborted) return;
      // Preparation runs in the background so the compatibility copy path is
      // ready when requested. Its result is reported by the actual copy
      // operation; opening or editing a Preview is not a copy failure.
      const currentPreparation = preparation;
      void prepare(surface, {
        background: true,
        signal: currentPreparation.controller.signal
      })
        .catch(() => undefined)
        .finally(() => {
          if (wechatBackgroundPreparationRef.current === currentPreparation) {
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
      visualPreviewWindowRequestedRef,
      wechatClipboard,
      wechatExportEnabled
    ]
  );

  const scheduleWechatPreviewPreparation = useCallback(
    (surface: HTMLElement | null) => {
      const prepare = wechatClipboard.prepare;
      if (!wechatExportEnabled || !surface || !prepare) return;
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
      wechatClipboard,
      wechatExportEnabled
    ]
  );

  const scheduleCurrentWechatPreviewPreparation = useCallback(() => {
    if (visualPreviewEditingRef.current) return;
    const surface = visualPreviewEditingRef.current
      ? visualEditorRuntimeRef.current?.surface
      : previewRuntimeRef.current?.surface;
    scheduleWechatPreviewPreparation(surface ?? null);
  }, [
    previewRuntimeRef,
    scheduleWechatPreviewPreparation,
    visualEditorRuntimeRef,
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
    wechatExportEnabled
  ]);

  useEffect(() => {
    if (!wechatExportEnabled || !wechatClipboard.prepare) {
      return undefined;
    }
    const surface =
      visualEditorSurface ?? previewRuntimeRef.current?.surface ?? null;
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
    visualEditorSurface,
    wechatClipboard,
    wechatExportEnabled
  ]);

  useEffect(() => {
    const previous = previousWechatLayoutRef.current;
    if (previous.immersive === immersive && previous.mode === immersiveMode) {
      return;
    }
    previousWechatLayoutRef.current = { immersive, mode: immersiveMode };
    scheduleCurrentWechatPreviewPreparation();
  }, [immersive, immersiveMode, scheduleCurrentWechatPreviewPreparation]);

  useEffect(
    () => () => cancelWechatBackgroundPreparation(),
    [cancelWechatBackgroundPreparation, wechatClipboard, wechatExportEnabled]
  );

  return {
    cancelWechatBackgroundPreparation,
    scheduleCurrentWechatPreviewPreparation,
    scheduleWechatPreviewPreparation
  };
}
