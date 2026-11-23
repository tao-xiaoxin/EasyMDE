import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from '@wordpress/element';

import type {
  EditorSessionOperation,
  EditorSessionPort
} from '../../contracts/ports/editor-session-port';
import { protectedEditorOperationError } from '../../contracts/ports/editor-session-port';
import type {
  NativePublishDraft,
  NativePublishPort,
  NativePublishSnapshot
} from '../../contracts/ports/native-publish-port';
import type { NativeSubmissionPort } from '../../contracts/ports/native-submission-port';
import type { PreviewRequestPort } from '../../contracts/ports/preview-request';
import type { RevisionPort } from '../../contracts/ports/revision-port';
import type { EditorDocumentSession } from '../../features/document-source/ui/EditorDocumentSource';
import { useEditorSession } from '../../features/editor-session/use-editor-session';
import {
  type LocalDraftSession,
  type LocalDraftSessionStatus,
  createLocalDraftSession
} from '../../features/local-drafts/local-draft-session';
import { EDITOR_MESSAGE_ALERT_AUTO_DISMISS_MS } from '../../shared/ui/EditorMessageAlert';
import type {
  CodeThemePreparation,
  EditorRootProps,
  EditorStatus,
  EditorStatusState,
  EditorSubmissionState,
  ImmersiveVisualEditorRuntime,
  SharedRef
} from './editor-root-types';

export type UseEditorSessionAndFormBridgeOptions = Readonly<{
  appearance: EditorRootProps['appearance'];
  cancelVisualUnlockPreparationRef: SharedRef<() => void>;
  codeThemePreparationRef: SharedRef<CodeThemePreparation | null>;
  fonts: EditorRootProps['fonts'];
  immersiveEnvironment: EditorRootProps['immersiveEnvironment'];
  immersiveRef: SharedRef<boolean>;
  isNewPost: boolean;
  localDraftStorage: EditorRootProps['localDraftStorage'];
  localDrafts: EditorRootProps['localDrafts'];
  nativePublishPort: NativePublishPort;
  nativeSubmissionPort: NativeSubmissionPort;
  onDocumentOwnerChange: EditorRootProps['onDocumentOwnerChange'];
  prepareSourceMutationRef: SharedRef<() => boolean>;
  previewPort: PreviewRequestPort;
  publishPost: EditorRootProps['publishPost'];
  reportFailure: (code: string) => void;
  restoreRevision: EditorRootProps['restoreRevision'];
  revisionPort: RevisionPort | null;
  sessionPort: EditorSessionPort;
  settings: EditorRootProps['settings'];
  visualEditorRuntimeRef: SharedRef<ImmersiveVisualEditorRuntime | null>;
  visualPreviewEditingRef: SharedRef<boolean>;
}>;

export function useEditorSessionAndFormBridge({
  appearance,
  cancelVisualUnlockPreparationRef,
  codeThemePreparationRef,
  fonts,
  immersiveEnvironment,
  immersiveRef,
  isNewPost,
  localDraftStorage,
  localDrafts,
  nativePublishPort,
  nativeSubmissionPort,
  onDocumentOwnerChange,
  prepareSourceMutationRef,
  previewPort: rawPreviewPort,
  publishPost,
  reportFailure,
  restoreRevision: rawRestoreRevision,
  revisionPort: rawRevisionPort,
  sessionPort,
  settings,
  visualEditorRuntimeRef,
  visualPreviewEditingRef
}: UseEditorSessionAndFormBridgeOptions) {
  const localDraftSessionRef = useRef<LocalDraftSession | null>(null);
  const initialSubmissionStateRef = useRef<EditorSubmissionState>({
    ...appearance.state,
    codeThemeExplicit: appearance.codeThemeExplicit,
    ...fonts.state
  });
  const submissionStateRef = useRef<EditorSubmissionState>(
    initialSubmissionStateRef.current
  );

  const [documentSession, setDocumentSession] =
    useState<EditorDocumentSession | null>(null);
  const [draftCandidate, setDraftCandidate] = useState(false);
  const [draftUnreadable, setDraftUnreadable] = useState(false);
  const [editorStatusState, setEditorStatusState] = useState<EditorStatusState>(
    { focused: false, status: null }
  );
  const editorStatus = editorStatusState.status;
  const editorStatusFocused = editorStatusState.focused;
  const editorStatusTimerRef = useRef<{
    deadline: number | null;
    remaining: number;
    status: EditorStatus | null;
  }>({
    deadline: null,
    remaining: EDITOR_MESSAGE_ALERT_AUTO_DISMISS_MS,
    status: null
  });
  const [cursorPosition, setCursorPosition] = useState({ column: 1, line: 1 });

  const localDraftsEnabled = settings.general.autoSave && localDrafts.enabled;
  const sessionSnapshot = useEditorSession(sessionPort);

  const publishEditorStatus = useCallback(
    (nextStatus: EditorStatus) =>
      setEditorStatusState((currentState) => {
        const next =
          'error' === currentState.status?.type
          && currentState.status.id !== nextStatus.id
          && 'error' !== nextStatus.type
            ? currentState.status
            : nextStatus;
        return next === currentState.status
          ? currentState
          : { ...currentState, status: next };
      }),
    []
  );

  const setLocalDraftStatus = useCallback(
    (status: LocalDraftSessionStatus) => {
      if (immersiveRef.current && 'saved' === status.code) return;
      publishEditorStatus({
        ...status,
        id: 'local-draft',
        owner: 'local-draft'
      });
    },
    [immersiveRef, publishEditorStatus]
  );

  useEffect(() => {
    const timerState = editorStatusTimerRef.current;
    if (!editorStatus) {
      timerState.deadline = null;
      timerState.remaining = EDITOR_MESSAGE_ALERT_AUTO_DISMISS_MS;
      timerState.status = null;
      return undefined;
    }
    if (timerState.status !== editorStatus) {
      timerState.deadline = null;
      timerState.remaining = EDITOR_MESSAGE_ALERT_AUTO_DISMISS_MS;
      timerState.status = editorStatus;
    }
    if (editorStatusFocused) return undefined;

    const scheduledStatus = editorStatus;
    const delay = timerState.remaining;
    timerState.deadline = immersiveEnvironment.now() + delay;
    const cancel = immersiveEnvironment.schedule(() => {
      timerState.deadline = null;
      timerState.remaining = 0;
      setEditorStatusState((currentState) =>
        currentState.status === scheduledStatus
          ? { focused: false, status: null }
          : currentState
      );
    }, delay);
    return () => {
      cancel();
      if (
        timerState.status === scheduledStatus
        && null !== timerState.deadline
      ) {
        timerState.remaining = Math.max(
          0,
          timerState.deadline - immersiveEnvironment.now()
        );
        timerState.deadline = null;
      }
    };
  }, [editorStatus, editorStatusFocused, immersiveEnvironment]);

  const protectedOperationError = useCallback(
    (operation: EditorSessionOperation) => {
      const error = protectedEditorOperationError(
        sessionPort.getSnapshot(),
        operation
      );
      if (error) reportFailure(error.message);
      return error;
    },
    [reportFailure, sessionPort]
  );

  const handleDocumentReady = useCallback((session: EditorDocumentSession) => {
    session.registerSubmissionState(initialSubmissionStateRef.current);
    setDocumentSession(session);
  }, []);

  useLayoutEffect(() => {
    if (!documentSession) return;
    onDocumentOwnerChange(true);
    return () => onDocumentOwnerChange(false);
  }, [documentSession, onDocumentOwnerChange]);

  const previewPort = useMemo<PreviewRequestPort>(
    () => ({
      render: (request, signal) => {
        const sessionError = protectedOperationError('post-read');
        return sessionError
          ? Promise.reject(sessionError)
          : rawPreviewPort.render(request, signal);
      }
    }),
    [protectedOperationError, rawPreviewPort]
  );

  const revisionPort = useMemo<RevisionPort | null>(() => {
    const port = rawRevisionPort;
    return port
      ? {
          get: (revisionId, signal) => {
            const sessionError = protectedOperationError('post-read');
            return sessionError
              ? Promise.reject(sessionError)
              : port.get(revisionId, signal);
          },
          list: (signal) => {
            const sessionError = protectedOperationError('post-read');
            return sessionError
              ? Promise.reject(sessionError)
              : port.list(signal);
          }
        }
      : null;
  }, [protectedOperationError, rawRevisionPort]);

  const restoreRevision = useCallback(
    (restoreUrl: string) => {
      const sessionError = protectedOperationError('post-write');
      if (sessionError) throw sessionError;
      rawRestoreRevision(restoreUrl);
    },
    [protectedOperationError, rawRestoreRevision]
  );

  const publish = useCallback(
    (draft: NativePublishDraft, original: NativePublishSnapshot): boolean => {
      if (!documentSession)
        throw new Error('immersive-publish-session-unavailable');
      const sessionError = protectedOperationError('post-write');
      if (sessionError) return false;
      try {
        nativePublishPort.apply(draft);
      } catch {
        reportFailure('immersive-publish-native-owner-unavailable');
        return false;
      }
      if (true !== publishPost(documentSession)) {
        try {
          nativePublishPort.apply(original);
        } catch {
          reportFailure('immersive-publish-native-restore-unavailable');
          return false;
        }
        reportFailure('immersive-publish-command-unavailable');
        return false;
      }
      return true;
    },
    [
      documentSession,
      nativePublishPort,
      protectedOperationError,
      publishPost,
      reportFailure
    ]
  );

  useEffect(() => {
    if (!documentSession) {
      return;
    }
    return sessionPort.subscribeBeforeAutosave(() => {
      if (codeThemePreparationRef.current) return 'blocked';
      if (visualPreviewEditingRef.current) {
        const runtime = visualEditorRuntimeRef.current;
        // Unlock publishes visual editing before the lazily mounted visual
        // editor reports its runtime. Until then the canonical source cannot
        // be proven current, so skip this autosave instead of throwing out of
        // the WordPress Heartbeat send hook.
        if (!runtime) return 'blocked';
        if (!runtime.prepareToolbarFallback()) return 'blocked';
      }
      documentSession.document.flush();
      return 'continue';
    });
  }, [
    codeThemePreparationRef,
    documentSession,
    sessionPort,
    visualEditorRuntimeRef,
    visualPreviewEditingRef
  ]);

  useEffect(() => {
    if (!documentSession) {
      return;
    }
    return nativeSubmissionPort.subscribeBeforeSubmit(() => {
      const sessionError = protectedOperationError('post-write');
      if (sessionError) return 'blocked';
      if (codeThemePreparationRef.current) {
        reportFailure('editor-appearance-pending');
        return 'blocked';
      }
      if (
        visualPreviewEditingRef.current
        && !prepareSourceMutationRef.current()
      ) {
        return 'blocked';
      }
      documentSession.document.flush();
      return 'continue';
    });
  }, [
    codeThemePreparationRef,
    documentSession,
    nativeSubmissionPort,
    prepareSourceMutationRef,
    protectedOperationError,
    reportFailure,
    visualPreviewEditingRef
  ]);

  useLayoutEffect(() => {
    if (
      !documentSession
      || !isNewPost
      || 'preview' === settings.general.editingMode
    )
      return;
    documentSession.document.focus();
  }, [documentSession, isNewPost, settings.general.editingMode]);

  useEffect(() => {
    if (!documentSession) {
      return;
    }
    const session = createLocalDraftSession({
      delayMs: Number(settings.general.autoSaveInterval) * 1000,
      document: {
        applyTextChange: documentSession.document.applyTextChange,
        focus: documentSession.document.focus,
        getValue: documentSession.document.getValue
      },
      enabled: localDraftsEnabled,
      onCandidate: setDraftCandidate,
      onDiagnostic: reportFailure,
      onUnreadable: setDraftUnreadable,
      onStatus: setLocalDraftStatus,
      savedFingerprint: localDrafts.savedFingerprint,
      storage: localDraftStorage,
      strings: localDrafts.strings
    });
    localDraftSessionRef.current = session;
    const schedule = () => session.schedule();
    const unsubscribeDocument = documentSession.document.subscribe(schedule);
    session.reconcileSavedDraft();

    return () => {
      unsubscribeDocument();
      if (localDraftSessionRef.current === session) {
        localDraftSessionRef.current = null;
      }
      session.dispose();
    };
  }, [
    documentSession,
    localDraftStorage,
    localDrafts,
    localDraftsEnabled,
    reportFailure,
    setLocalDraftStatus,
    settings.general.autoSaveInterval
  ]);

  useEffect(() => {
    if (!documentSession) return undefined;
    const update = () =>
      setCursorPosition(documentSession.document.getCursorPosition());
    update();
    const unsubscribeDocument = documentSession.document.subscribe(() => {
      update();
      const preparation = codeThemePreparationRef.current;
      if (
        'visual-unlock' === preparation?.owner
        && preparation.sourceMarkdown !== documentSession.document.getValue()
      ) {
        cancelVisualUnlockPreparationRef.current();
      }
    });
    const unsubscribeSelection =
      documentSession.document.subscribeSelection(update);
    return () => {
      unsubscribeDocument();
      unsubscribeSelection();
    };
  }, [
    cancelVisualUnlockPreparationRef,
    codeThemePreparationRef,
    documentSession
  ]);

  return {
    cursorPosition,
    documentSession,
    draftCandidate,
    draftUnreadable,
    editorStatus,
    handleDocumentReady,
    localDraftSessionRef,
    localDraftsEnabled,
    previewPort,
    protectedOperationError,
    publish,
    publishEditorStatus,
    restoreRevision,
    revisionPort,
    sessionSnapshot,
    setEditorStatusState,
    submissionStateRef
  };
}
