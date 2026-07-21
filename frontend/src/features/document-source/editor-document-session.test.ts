import { describe, expect, it, vi } from 'vitest';

import type { CodeMirrorDocumentSession } from './adapters/code-mirror-document-session';
import type { NativeTitleSession } from './adapters/native-title-session';
import { createEditorDocumentSession } from './editor-document-session';

function externalSession<T>(initial: T) {
  let snapshot = initial;
  const listeners = new Set<() => void>();
  return {
    destroy: vi.fn(),
    emit(next: T) {
      snapshot = next;
      for (const listener of listeners) listener();
    },
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
}

describe('createEditorDocumentSession', () => {
  it('derives dirty state from both Markdown and WordPress title baselines', () => {
    const documentState = externalSession({ savedValue: '# Saved', value: '# Saved' });
    const titleState = externalSession({ savedValue: 'Saved title', value: 'Saved title' });
    const session = createEditorDocumentSession(
      documentState as unknown as CodeMirrorDocumentSession,
      titleState as unknown as NativeTitleSession
    );

    expect(session.getSnapshot()).toEqual({ dirty: false });
    expect(session.getSnapshot()).toBe(session.getSnapshot());

    documentState.emit({ savedValue: '# Saved', value: '# Edited' });
    expect(session.getSnapshot()).toEqual({ dirty: true });

    documentState.emit({ savedValue: '# Saved', value: '# Saved' });
    titleState.emit({ savedValue: 'Saved title', value: 'Edited title' });
    expect(session.getSnapshot()).toEqual({ dirty: true });

    titleState.emit({ savedValue: 'Saved title', value: 'Saved title' });
    expect(session.getSnapshot()).toEqual({ dirty: false });
    session.destroy();
  });

  it('publishes only real dirty-state transitions and releases both subscriptions', () => {
    const documentState = externalSession({ savedValue: 'saved', value: 'saved' });
    const titleState = externalSession({ savedValue: 'title', value: 'title' });
    const listener = vi.fn();
    const session = createEditorDocumentSession(
      documentState as unknown as CodeMirrorDocumentSession,
      titleState as unknown as NativeTitleSession
    );
    const unsubscribe = session.subscribe(listener);

    documentState.emit({ savedValue: 'saved', value: 'edited' });
    titleState.emit({ savedValue: 'title', value: 'edited title' });
    documentState.emit({ savedValue: 'saved', value: 'saved' });
    expect(listener).toHaveBeenCalledTimes(1);

    titleState.emit({ savedValue: 'title', value: 'title' });
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    session.destroy();
    session.destroy();
    documentState.emit({ savedValue: 'saved', value: 'later' });
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
