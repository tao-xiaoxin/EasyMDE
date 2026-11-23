import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from '@wordpress/element';
import type { CSSProperties } from 'react';

import type {
  AppearanceBootstrap,
  AppearanceState
} from '../../contracts/bootstrap/appearance-bootstrap';
import type { FontControlsBootstrap } from '../../contracts/bootstrap/font-controls-bootstrap';
import type { AppearancePort } from '../../contracts/ports/appearance-port';
import type { EditorSessionOperation } from '../../contracts/ports/editor-session-port';
import type { FontControlsPort } from '../../contracts/ports/font-controls-port';
import { buildFontStack } from '../../domain/font-stack';
import type {
  AppearanceControlsSession,
  AppearanceNotification
} from '../../features/appearance/ui/AppearanceControls';
import type { EditorDocumentSession } from '../../features/document-source/ui/EditorDocumentSource';
import type { OrdinaryEditorSettingsSession } from '../../features/editor-settings/ui/OrdinaryEditorSettings';
import type { FontControlsSession } from '../../features/font-controls/ui/FontControls';
import {
  type PreviewEnhancementPort,
  previewEnhancementFailureCode
} from '../../features/live-preview/ports/preview-enhancement-port';
import type { PreviewSurfaceRuntime } from '../../features/live-preview/ui/PreviewSurfaceOwner';
import type { EditorToolbarSession } from '../../features/toolbar/ui/EditorToolbar';
import { articleMarkupProfile } from './editor-root-helpers';
import type {
  CodeThemePreparation,
  EditorStatus,
  EditorStatusState,
  EditorSubmissionState,
  SharedRef
} from './editor-root-types';

export type UseEditorAppearanceBridgeOptions = Readonly<{
  appearance: AppearanceBootstrap;
  appearancePort: AppearancePort;
  appearanceSessionRef: SharedRef<AppearanceControlsSession | null>;
  cancelVisualUnlockPreparation: () => void;
  codeThemePreparationGenerationRef: SharedRef<number>;
  codeThemePreparationRef: SharedRef<CodeThemePreparation | null>;
  documentSession: EditorDocumentSession | null;
  enhancementPort: PreviewEnhancementPort;
  fontControlsPort: FontControlsPort;
  fontControlsSessionRef: SharedRef<FontControlsSession | null>;
  fonts: FontControlsBootstrap;
  ordinarySettingsSessionRef: SharedRef<OrdinaryEditorSettingsSession | null>;
  prepareSourceMutationWithPreview: (
    options?: Readonly<{
      requireSync?: boolean;
      suppressRefresh?: boolean;
      isCurrent?: () => boolean;
    }>
  ) => Promise<boolean>;
  previewAppearanceRef: SharedRef<AppearanceState>;
  previewRefreshPendingRef: SharedRef<boolean>;
  previewRuntimeRef: SharedRef<PreviewSurfaceRuntime | null>;
  protectedOperationError: (operation: EditorSessionOperation) => Error | null;
  publishEditorStatus: (status: EditorStatus) => void;
  reportFailure: (code: string) => void;
  rootActiveRef: SharedRef<boolean>;
  scheduleCurrentWechatPreviewPreparation: () => void;
  schedulePreview: (immediate?: boolean) => void;
  scheduleWechatPreviewPreparation: (surface: HTMLElement | null) => void;
  setEditorStatusState: (
    updater: (current: EditorStatusState) => EditorStatusState
  ) => void;
  submissionStateRef: SharedRef<EditorSubmissionState>;
  toolbarSessionRef: SharedRef<EditorToolbarSession | null>;
  visualPreviewEditingRef: SharedRef<boolean>;
}>;

export function useEditorAppearanceBridge({
  appearance,
  appearancePort: rawAppearancePort,
  appearanceSessionRef,
  cancelVisualUnlockPreparation,
  codeThemePreparationGenerationRef,
  codeThemePreparationRef,
  documentSession,
  enhancementPort,
  fontControlsPort: rawFontControlsPort,
  fontControlsSessionRef,
  fonts,
  ordinarySettingsSessionRef,
  prepareSourceMutationWithPreview,
  previewAppearanceRef,
  previewRefreshPendingRef,
  previewRuntimeRef,
  protectedOperationError,
  publishEditorStatus,
  reportFailure,
  rootActiveRef,
  scheduleCurrentWechatPreviewPreparation,
  schedulePreview,
  scheduleWechatPreviewPreparation,
  setEditorStatusState,
  submissionStateRef,
  toolbarSessionRef,
  visualPreviewEditingRef
}: UseEditorAppearanceBridgeOptions) {
  const codeThemeFrameSyncPendingRef = useRef<string | null>(null);
  const codeThemeExplicitRef = useRef(appearance.codeThemeExplicit);

  const [appearanceSnapshot, setAppearanceSnapshot] = useState(() => ({
    customCss: appearance.customCss,
    state: appearance.state
  }));
  const appearanceSnapshotRef = useRef(appearanceSnapshot);
  const appearanceState = appearanceSnapshot.state;

  const [codeThemeExplicit, setCodeThemeExplicit] = useState(
    appearance.codeThemeExplicit
  );
  const [renderedCodeTheme, setRenderedCodeTheme] = useState(
    appearance.state.codeTheme
  );
  const currentAppearance = useMemo<AppearanceBootstrap>(
    () => ({
      ...appearance,
      ...appearanceSnapshot,
      codeThemeExplicit
    }),
    [appearance, appearanceSnapshot, codeThemeExplicit]
  );

  const [fontState, setFontState] = useState(fonts.state);
  const currentFonts = useMemo<FontControlsBootstrap>(
    () => ({ ...fonts, state: fontState }),
    [fontState, fonts]
  );

  const setAppearanceNotification = useCallback(
    (notification: AppearanceNotification) =>
      publishEditorStatus({ ...notification, owner: 'editor' }),
    [publishEditorStatus]
  );

  const dismissAppearanceNotification = useCallback(
    (id: AppearanceNotification['id']) => {
      setEditorStatusState((currentState) =>
        id === currentState.status?.id
          ? { focused: false, status: null }
          : currentState
      );
    },
    [setEditorStatusState]
  );

  useEffect(() => () => rawAppearancePort.dispose(), [rawAppearancePort]);

  useEffect(
    () => () => {
      codeThemePreparationRef.current?.controller.abort();
      codeThemePreparationRef.current?.prepared?.cancel();
      codeThemePreparationRef.current = null;
      rawAppearancePort.cancelPendingApply();
    },
    [codeThemePreparationRef, rawAppearancePort]
  );

  const appearancePort = useMemo<AppearancePort>(
    () => ({
      applyState: async (state, nextCodeThemeExplicit) => {
        const previousState = previewAppearanceRef.current;
        const codeThemeChanged = previousState.codeTheme !== state.codeTheme;
        const markupChanged =
          articleMarkupProfile(appearance, previousState)
          !== articleMarkupProfile(appearance, state);
        const visualPreviewWasEditing = visualPreviewEditingRef.current;
        if (
          visualPreviewWasEditing
          && !(await prepareSourceMutationWithPreview())
        ) {
          throw new Error('visual-editor-source-sync-failed');
        }
        cancelVisualUnlockPreparation();
        codeThemePreparationRef.current?.controller.abort();
        codeThemePreparationRef.current?.prepared?.cancel();
        rawAppearancePort.cancelPendingApply();
        const controller = new AbortController();
        const generation = ++codeThemePreparationGenerationRef.current;
        const preparation: CodeThemePreparation = {
          controller,
          generation,
          owner: 'appearance',
          prepared: null
        };
        codeThemePreparationRef.current = preparation;
        if (codeThemeChanged) {
          try {
            preparation.prepared = await enhancementPort.prepareCodeTheme({
              codeTheme: state.codeTheme,
              signal: controller.signal
            });
          } catch (error: unknown) {
            if (
              !controller.signal.aborted
              && codeThemePreparationRef.current?.generation === generation
              && rootActiveRef.current
            ) {
              reportFailure(previewEnhancementFailureCode(error));
            }
            if (codeThemePreparationRef.current?.generation === generation) {
              codeThemePreparationRef.current = null;
            }
            return false;
          }
          if (
            controller.signal.aborted
            || codeThemePreparationRef.current?.generation !== generation
            || !rootActiveRef.current
          ) {
            preparation.prepared.cancel();
            return false;
          }
        }
        let applied: boolean;
        try {
          applied = await rawAppearancePort.applyState(
            state,
            nextCodeThemeExplicit
          );
        } catch {
          preparation.prepared?.cancel();
          if (codeThemePreparationRef.current?.generation === generation) {
            codeThemePreparationRef.current = null;
          }
          if (rootActiveRef.current) {
            reportFailure('react-editor-appearance-failed');
          }
          return false;
        }
        if (
          !applied
          || controller.signal.aborted
          || codeThemePreparationRef.current?.generation !== generation
          || !rootActiveRef.current
        ) {
          preparation.prepared?.cancel();
          if (codeThemePreparationRef.current?.generation === generation) {
            codeThemePreparationRef.current = null;
          }
          return false;
        }
        preparation.prepared?.commit();
        codeThemePreparationRef.current = null;
        if (codeThemeChanged) {
          codeThemeFrameSyncPendingRef.current = state.codeTheme;
          setRenderedCodeTheme(state.codeTheme);
        }
        codeThemeExplicitRef.current = nextCodeThemeExplicit;
        setCodeThemeExplicit(nextCodeThemeExplicit);
        const nextSnapshot = { ...appearanceSnapshotRef.current, state };
        appearanceSnapshotRef.current = nextSnapshot;
        setAppearanceSnapshot(nextSnapshot);
        appearanceSessionRef.current?.replaceSnapshot(
          nextSnapshot,
          nextCodeThemeExplicit
        );
        submissionStateRef.current = {
          ...submissionStateRef.current,
          ...state,
          codeThemeExplicit: nextCodeThemeExplicit
        };
        documentSession?.replaceSubmissionState(submissionStateRef.current);
        previewAppearanceRef.current = state;
        const defaults = appearance.articleThemes.find(
          ({ id }) => id === state.markdownTheme
        )?.fontDefaults;
        if (defaults) {
          fontControlsSessionRef.current?.replaceState(defaults);
        }
        const customCssChanged =
          previousState.customCssId !== state.customCssId
          || ('custom' === state.markdownTheme
            && 'custom' !== previousState.markdownTheme);
        if (markupChanged || visualPreviewWasEditing || customCssChanged) {
          previewRefreshPendingRef.current = true;
          schedulePreview(true);
        } else {
          scheduleCurrentWechatPreviewPreparation();
        }
        return true;
      },
      cancelPendingApply: () => {
        cancelVisualUnlockPreparation();
        codeThemePreparationRef.current?.controller.abort();
        codeThemePreparationRef.current?.prepared?.cancel();
        codeThemePreparationRef.current = null;
        rawAppearancePort.cancelPendingApply();
      },
      closeOtherPopovers: () => {
        toolbarSessionRef.current?.closePopovers();
        fontControlsSessionRef.current?.close();
        ordinarySettingsSessionRef.current?.close();
        rawAppearancePort.closeOtherPopovers();
      },
      dispose: () => undefined,
      previewCustomCss: (css, signal) =>
        rawAppearancePort.previewCustomCss(css, signal),
      saveCustomCss: async (input) => {
        const sessionError = protectedOperationError('authenticated');
        if (sessionError) throw sessionError;
        const visualPreviewWasEditing = visualPreviewEditingRef.current;
        if (
          visualPreviewWasEditing
          && !(await prepareSourceMutationWithPreview())
        ) {
          throw new Error('visual-editor-source-sync-failed');
        }
        const result = await rawAppearancePort.saveCustomCss(input);
        if ('saved' === result.status) {
          // The server mutation and local theme activation are separate
          // operations. Publish the authoritative saved library immediately;
          // AppearanceControls applies the selected theme exactly once through
          // applyState, which commits preview and submission state only after
          // its stylesheet has loaded.
          if (rootActiveRef.current) {
            const nextSnapshot = {
              ...appearanceSnapshotRef.current,
              customCss: result.snapshot.customCss
            };
            appearanceSnapshotRef.current = nextSnapshot;
            setAppearanceSnapshot(nextSnapshot);
            appearanceSessionRef.current?.replaceSnapshot(
              nextSnapshot,
              codeThemeExplicitRef.current
            );
          }
        }
        return result;
      }
    }),
    [
      appearance,
      appearanceSessionRef,
      cancelVisualUnlockPreparation,
      codeThemePreparationGenerationRef,
      codeThemePreparationRef,
      documentSession,
      enhancementPort,
      fontControlsSessionRef,
      ordinarySettingsSessionRef,
      prepareSourceMutationWithPreview,
      previewAppearanceRef,
      previewRefreshPendingRef,
      protectedOperationError,
      rawAppearancePort,
      reportFailure,
      rootActiveRef,
      scheduleCurrentWechatPreviewPreparation,
      schedulePreview,
      submissionStateRef,
      toolbarSessionRef,
      visualPreviewEditingRef
    ]
  );

  const fontControlsPort = useMemo<FontControlsPort>(
    () => ({
      applyState: (state) => {
        rawFontControlsPort.applyState(state);
        setFontState(state);
        submissionStateRef.current = {
          ...submissionStateRef.current,
          ...state
        };
        documentSession?.replaceSubmissionState(submissionStateRef.current);
        scheduleWechatPreviewPreparation(
          previewRuntimeRef.current?.surface ?? null
        );
      },
      closeOtherPopovers: () => {
        toolbarSessionRef.current?.closePopovers();
        appearanceSessionRef.current?.close();
        ordinarySettingsSessionRef.current?.close();
        rawFontControlsPort.closeOtherPopovers();
      }
    }),
    [
      appearanceSessionRef,
      documentSession,
      ordinarySettingsSessionRef,
      previewRuntimeRef,
      rawFontControlsPort,
      scheduleWechatPreviewPreparation,
      submissionStateRef,
      toolbarSessionRef
    ]
  );

  useLayoutEffect(() => {
    if (codeThemeFrameSyncPendingRef.current !== renderedCodeTheme) return;
    codeThemeFrameSyncPendingRef.current = null;
    const surface = previewRuntimeRef.current?.surface;
    if (!surface) {
      reportFailure('preview-enhancement-runtime-unavailable');
      return;
    }
    try {
      enhancementPort.syncCodeFrameBackgrounds(surface);
      scheduleCurrentWechatPreviewPreparation();
    } catch (error) {
      reportFailure(previewEnhancementFailureCode(error));
    }
  }, [
    enhancementPort,
    previewRuntimeRef,
    renderedCodeTheme,
    reportFailure,
    scheduleCurrentWechatPreviewPreparation
  ]);

  const activeArticleTheme = appearance.articleThemes.find(
    ({ id }) => id === appearanceState.markdownTheme
  );
  const previewFontStack = buildFontStack(
    fonts.options,
    fontState,
    activeArticleTheme?.usesThemeFontFamily
      ? 'var(--easymde-theme-font-family, sans-serif)'
      : ''
  );
  const usesCrimsonThemeDefaults =
    'crimson-focus' === appearanceState.markdownTheme
    && 'theme-default' === fontState.serifFont
    && Boolean(previewFontStack);
  const previewClassName = [
    'easymde-preview',
    'easymde-rendered-content',
    'easymde-code-mac',
    `easymde-markdown-theme-${appearanceState.markdownTheme}`,
    `easymde-code-theme-${renderedCodeTheme}`,
    'custom' === appearanceState.markdownTheme
      ? 'easymde-custom-css-active'
      : '',
    previewFontStack ? 'easymde-font-overrides' : '',
    usesCrimsonThemeDefaults ? 'easymde-theme-default-fonts' : ''
  ]
    .filter(Boolean)
    .join(' ');
  const previewStyle = {
    ...(previewFontStack
      ? {
          '--easymde-content-font-family': previewFontStack
        }
      : {})
  } as CSSProperties;

  return {
    appearancePort,
    currentAppearance,
    currentFonts,
    dismissAppearanceNotification,
    fontControlsPort,
    previewClassName,
    previewStyle,
    setAppearanceNotification
  };
}
