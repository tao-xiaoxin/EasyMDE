import { describe, expect, it, vi } from 'vitest';

import { createAdminEditorLocalDraftsBridge } from './admin-editor-local-drafts';

function createStorage(initial: Readonly<Record<string, string>> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    clear: vi.fn(() => values.clear()),
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    key: vi.fn((index: number) => Array.from(values.keys())[index] ?? null),
    get length() {
      return values.size;
    },
    removeItem: vi.fn((key: string) => values.delete(key)),
    setItem: vi.fn((key: string, value: string) => values.set(key, value))
  } as Storage;
}

const bootstrap = {
  enabled: true,
  locale: 'en_US',
  maxBytes: 1024,
  postId: 17,
  schemaVersion: 1,
  siteKey: 'site',
  strings: {
    available: 'A newer local draft is available.',
    conflict: 'A different local draft was saved in another tab.',
    discard: 'Discard draft',
    discardFailed: 'Draft discard failed.',
    discarded: 'Draft discarded.',
    readFailed: 'Draft read failed.',
    restore: 'Restore draft',
    restored: 'Draft restored.',
    saveFailed: 'Draft save failed.',
    saved: 'Local draft saved'
  },
  timeZone: 'UTC',
  userId: 7
};

describe('createAdminEditorLocalDraftsBridge', () => {
  it('performs a read-only startup inspection before activation', () => {
    const storage = createStorage();
    const bridge = createAdminEditorLocalDraftsBridge(bootstrap, {
      eventTarget: window,
      now: () => 1000,
      storage
    });

    expect(bridge.inspect('saved-fingerprint')).toEqual({ status: 'missing' });
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it('activates one session and disposes its storage subscription idempotently', () => {
    vi.useFakeTimers();
    const storage = createStorage();
    const removeEventListener = vi.spyOn(window, 'removeEventListener');
    const bridge = createAdminEditorLocalDraftsBridge(bootstrap, {
      eventTarget: window,
      now: () => 1000,
      storage
    });
    const session = bridge.activate({
      document: {
        applyTextChange: vi.fn(),
        focus: vi.fn(),
        getValue: () => 'Current draft'
      },
      onCandidate: vi.fn(),
      onDiagnostic: vi.fn(),
      onStatus: vi.fn(),
      savedFingerprint: 'saved-fingerprint'
    });

    expect(session.schedule()).toBe(true);
    vi.advanceTimersByTime(500);
    expect(storage.setItem).toHaveBeenCalledWith(
      'easymde:draft:v1:site:7:17',
      expect.stringContaining('Current draft')
    );
    session.dispose();
    session.dispose();
    expect(removeEventListener).toHaveBeenCalledTimes(1);
    removeEventListener.mockRestore();
    vi.useRealTimers();
  });

  it('fails before handoff for invalid bootstrap, storage, or document capabilities', () => {
    expect(() => createAdminEditorLocalDraftsBridge({ ...bootstrap, schemaVersion: 2 }, {
      eventTarget: window,
      now: () => 1,
      storage: createStorage()
    })).toThrow('local-drafts-schema-version-invalid');

    expect(() => createAdminEditorLocalDraftsBridge(bootstrap, {
      eventTarget: window,
      now: () => 1,
      storage: null
    })).toThrow('local-drafts-storage-unavailable');

    const bridge = createAdminEditorLocalDraftsBridge(bootstrap, {
      eventTarget: window,
      now: () => 1,
      storage: createStorage()
    });
    expect(() => bridge.activate({
      document: {} as never,
      onCandidate: vi.fn(),
      onDiagnostic: vi.fn(),
      onStatus: vi.fn(),
      savedFingerprint: ''
    })).toThrow('local-drafts-activation-invalid');
  });
});
