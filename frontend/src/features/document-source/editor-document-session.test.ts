import { describe, expect, it, vi } from 'vitest';

import type { CodeMirrorDocumentSession } from './adapters/code-mirror-document-session';
import type { NativeTitleSession } from './adapters/native-title-session';
import { createEditorDocumentSession } from './editor-document-session';

const submissionState = {
  appleFont: 'system',
  codeTheme: 'dark',
  customCssId: '',
  customFont: 'none',
  markdownTheme: 'default',
  serifFont: 'off',
  windowsFont: 'system'
} as const;

function externalSession<T extends Readonly<{ savedValue: string; value: string }>>(initial: T) {
  let snapshot = initial;
  const listeners = new Set<() => void>();
  return {
    destroy: vi.fn(),
    emit(next: T) {
      snapshot = next;
      for (const listener of listeners) listener();
    },
    getSnapshot: () => snapshot,
    replaceSavedValue(savedValue: string) {
      snapshot = { ...snapshot, savedValue };
      for (const listener of listeners) listener();
    },
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

  it('tracks every appearance and font submission field against the saved baseline', () => {
    const documentState = externalSession({ savedValue: 'saved', value: 'saved' });
    const titleState = externalSession({ savedValue: 'title', value: 'title' });
    const session = createEditorDocumentSession(
      documentState as unknown as CodeMirrorDocumentSession,
      titleState as unknown as NativeTitleSession
    );

    session.registerSubmissionState(submissionState);
    expect(session.getSnapshot()).toEqual({ dirty: false });

    for (const [key, value] of Object.entries({
      appleFont: 'alternate-apple',
      codeTheme: 'light',
      customCssId: 'custom-1',
      customFont: 'optima',
      markdownTheme: 'newsprint',
      serifFont: 'on',
      windowsFont: 'alternate-windows'
    })) {
      session.replaceSubmissionState({ ...submissionState, [key]: value });
      expect(session.getSnapshot()).toEqual({ dirty: true });
      session.replaceSubmissionState(submissionState);
      expect(session.getSnapshot()).toEqual({ dirty: false });
    }

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

  it('reconciles the exact authoritative save snapshot without clearing later edits', () => {
    const documentState = externalSession({ savedValue: 'saved', value: 'later edit' });
    const titleState = externalSession({ savedValue: 'title', value: 'later title' });
    const session = createEditorDocumentSession(
      documentState as unknown as CodeMirrorDocumentSession,
      titleState as unknown as NativeTitleSession
    );
    session.registerSubmissionState(submissionState);

    const savedSubmissionState = { ...submissionState, markdownTheme: 'newsprint' };
    session.replaceSubmissionState(savedSubmissionState);
    session.reconcileSavedBaseline({
      markdown: 'submitted edit',
      submissionState: savedSubmissionState,
      title: 'submitted title'
    });

    expect(documentState.getSnapshot()).toEqual({
      savedValue: 'submitted edit',
      value: 'later edit'
    });
    expect(titleState.getSnapshot()).toEqual({
      savedValue: 'submitted title',
      value: 'later title'
    });
    expect(session.getSnapshot()).toEqual({ dirty: true });
    session.destroy();
  });
});
