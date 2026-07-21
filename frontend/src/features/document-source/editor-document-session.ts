import type { CodeMirrorDocumentSession } from './adapters/code-mirror-document-session';
import type { NativeTitleSession } from './adapters/native-title-session';

export type EditorDocumentSnapshot = Readonly<{
  dirty: boolean;
}>;

export type EditorDocumentSession = Readonly<{
  destroy: () => void;
  document: CodeMirrorDocumentSession;
  getSnapshot: () => EditorDocumentSnapshot;
  subscribe: (listener: () => void) => () => void;
  title: NativeTitleSession;
}>;

export function createEditorDocumentSession(
  document: CodeMirrorDocumentSession,
  title: NativeTitleSession
): EditorDocumentSession {
  const listeners = new Set<() => void>();
  let active = true;
  let snapshot: EditorDocumentSnapshot = {
    dirty: isDirty()
  };

  function isDirty(): boolean {
    const documentSnapshot = document.getSnapshot();
    const titleSnapshot = title.getSnapshot();
    return documentSnapshot.value !== documentSnapshot.savedValue
      || titleSnapshot.value !== titleSnapshot.savedValue;
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
