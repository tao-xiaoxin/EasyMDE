import type { CodeMirrorDocumentSession } from './adapters/code-mirror-document-session';
import type { NativeTitleSession } from './adapters/native-title-session';

export type EditorDocumentSnapshot = Readonly<{
  dirty: boolean;
}>;

export type EditorSubmissionState = Readonly<{
  appleFont: string;
  codeTheme: string;
  customCssId: string;
  customFont: string;
  markdownTheme: string;
  serifFont: string;
  windowsFont: string;
}>;

export type EditorSavedBaseline = Readonly<{
  markdown: string;
  submissionState: EditorSubmissionState;
  title: string;
}>;

export type EditorDocumentSession = Readonly<{
  destroy: () => void;
  document: CodeMirrorDocumentSession;
  getSnapshot: () => EditorDocumentSnapshot;
  registerSubmissionState: (state: EditorSubmissionState) => void;
  reconcileSavedBaseline: (baseline: EditorSavedBaseline) => void;
  replaceSubmissionState: (state: EditorSubmissionState) => void;
  subscribe: (listener: () => void) => () => void;
  title: NativeTitleSession;
}>;

export function createEditorDocumentSession(
  document: CodeMirrorDocumentSession,
  title: NativeTitleSession
): EditorDocumentSession {
  const listeners = new Set<() => void>();
  let active = true;
  let submissionState: EditorSubmissionState | null = null;
  let savedSubmissionState: EditorSubmissionState | null = null;
  let snapshot: EditorDocumentSnapshot = {
    dirty: isDirty()
  };

  function isDirty(): boolean {
    const documentSnapshot = document.getSnapshot();
    const titleSnapshot = title.getSnapshot();
    return documentSnapshot.value !== documentSnapshot.savedValue
      || titleSnapshot.value !== titleSnapshot.savedValue
      || (
        null !== submissionState
        && null !== savedSubmissionState
        && !submissionStatesEqual(submissionState, savedSubmissionState)
      );
  }

  function submissionStatesEqual(
    current: EditorSubmissionState,
    saved: EditorSubmissionState
  ): boolean {
    return current.appleFont === saved.appleFont
      && current.codeTheme === saved.codeTheme
      && current.customCssId === saved.customCssId
      && current.customFont === saved.customFont
      && current.markdownTheme === saved.markdownTheme
      && current.serifFont === saved.serifFont
      && current.windowsFont === saved.windowsFont;
  }

  const publish = () => {
    if (!active) {
      return;
    }
    const dirty = isDirty();
    if (dirty === snapshot.dirty) {
      return;
    }
    snapshot = { dirty };
    for (const listener of listeners) {
      listener();
    }
  };
  const unsubscribeDocument = document.subscribe(publish);
  const unsubscribeTitle = title.subscribe(publish);

  return {
    destroy() {
      if (!active) {
        return;
      }
      active = false;
      listeners.clear();
      unsubscribeDocument();
      unsubscribeTitle();
      title.destroy();
      document.destroy();
    },
    document,
    getSnapshot: () => snapshot,
    registerSubmissionState(state) {
      if (!active) return;
      if (null !== submissionState) {
        throw new Error('editor-submission-state-already-registered');
      }
      submissionState = state;
      savedSubmissionState = state;
      publish();
    },
    reconcileSavedBaseline(baseline) {
      if (!active) return;
      if (null === submissionState) {
        throw new Error('editor-submission-state-unavailable');
      }
      savedSubmissionState = baseline.submissionState;
      document.replaceSavedValue(baseline.markdown);
      title.replaceSavedValue(baseline.title);
      publish();
    },
    replaceSubmissionState(state) {
      if (!active) return;
      if (null === submissionState) {
        throw new Error('editor-submission-state-unavailable');
      }
      if (submissionStatesEqual(submissionState, state)) return;
      submissionState = state;
      publish();
    },
    subscribe(listener: () => void) {
      if (!active) {
        return () => {};
      }
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    title
  };
}
