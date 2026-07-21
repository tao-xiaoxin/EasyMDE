import { describe, expect, it, vi } from 'vitest';

import type {
  LocalDraft,
  LocalDraftReadResult,
  LocalDraftStoragePort
} from '../../contracts/ports/local-drafts-port';
import { createLocalDraftSession } from './local-draft-session';

function createDraft(content: string, updatedAt = 1000): LocalDraft {
  return { content, contentHash: `hash:${content}`, schemaVersion: 1, updatedAt };
}

function createStorage(initial: LocalDraftReadResult = { status: 'missing' }) {
  let result = initial;
  let listener: (() => void) | null = null;
  const port: LocalDraftStoragePort = {
    discard: vi.fn(() => {
      result = { status: 'missing' };
      return { status: 'discarded' as const };
    }),
    fingerprint: vi.fn((content: string) => `hash:${content}`),
    formatTime: vi.fn(() => ({ status: 'formatted' as const, value: '12:34' })),
    read: vi.fn(() => result),
    subscribe: vi.fn((nextListener) => {
      listener = nextListener;
      return () => {
        listener = null;
      };
    }),
    write: vi.fn((content: string) => {
      result = { draft: createDraft(content, 2000), source: 'current', status: 'available' };
      return { status: 'saved' as const, updatedAt: 2000 };
    })
  };
  return {
    emit(next: LocalDraftReadResult) {
      result = next;
      listener?.();
    },
    port
  };
}

const strings = {
  conflict: 'A newer local draft exists in another tab.',
  discardFailed: 'Discard failed.',
  discarded: 'Draft discarded.',
  readFailed: 'Read failed.',
  restored: 'Draft restored.',
  saveFailed: 'Save failed.',
  saved: 'Local draft saved'
};

describe('createLocalDraftSession', () => {
  it('schedules one latest draft write and reports authoritative storage success', () => {
    vi.useFakeTimers();
    let value = 'first';
    const storage = createStorage();
    const onStatus = vi.fn();
    const session = createLocalDraftSession({
      delayMs: 500,
      document: {
        applyTextChange: vi.fn(),
        focus: vi.fn(),
        getValue: () => value
      },
      enabled: true,
      onCandidate: vi.fn(),
      onDiagnostic: vi.fn(),
      onStatus,
      storage: storage.port,
      strings
    });

    session.schedule();
    value = 'latest';
    session.schedule();
    vi.advanceTimersByTime(500);

    expect(storage.port.write).toHaveBeenCalledTimes(1);
    expect(storage.port.write).toHaveBeenCalledWith('latest');
    expect(onStatus).toHaveBeenCalledWith({
      code: 'saved',
      message: 'Local draft saved 12:34',
      type: 'success'
    });
    session.dispose();
    vi.useRealTimers();
  });

  it('persists an explicitly bridged owner value instead of a stale normal document snapshot', () => {
    vi.useFakeTimers();
    const storage = createStorage();
    const session = createLocalDraftSession({
      delayMs: 500,
      document: {
        applyTextChange: vi.fn(),
        focus: vi.fn(),
        getValue: () => 'stale normal editor value'
      },
      enabled: true,
      onCandidate: vi.fn(),
      onDiagnostic: vi.fn(),
      onStatus: vi.fn(),
      storage: storage.port,
      strings
    });

    session.schedule('latest Focus Mode value');
    vi.advanceTimersByTime(500);

    expect(storage.port.write).toHaveBeenCalledOnce();
    expect(storage.port.write).toHaveBeenCalledWith('latest Focus Mode value');
    session.dispose();
    vi.useRealTimers();
  });

  it('surfaces storage failure and never reports a successful save', () => {
    vi.useFakeTimers();
    const storage = createStorage();
    vi.mocked(storage.port.write).mockReturnValue({ code: 'local-draft-write-failed', status: 'failed' });
    const onDiagnostic = vi.fn();
    const onStatus = vi.fn();
    const session = createLocalDraftSession({
      delayMs: 500,
      document: { applyTextChange: vi.fn(), focus: vi.fn(), getValue: () => 'draft' },
      enabled: true,
      onCandidate: vi.fn(),
      onDiagnostic,
      onStatus,
      storage: storage.port,
      strings
    });

    session.schedule();
    vi.advanceTimersByTime(500);

    expect(onDiagnostic).toHaveBeenCalledWith('local-draft-write-failed');
    expect(onStatus).toHaveBeenCalledWith({ code: 'save-failed', message: 'Save failed.', type: 'error' });
    expect(onStatus).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
    session.dispose();
    vi.useRealTimers();
  });

  it('restores or discards an available draft through one session owner', () => {
    const draft = createDraft('Recovered');
    const storage = createStorage({ draft, source: 'current', status: 'available' });
    const applyTextChange = vi.fn();
    const focus = vi.fn();
    const onCandidate = vi.fn();
    const onStatus = vi.fn();
    const session = createLocalDraftSession({
      delayMs: 500,
      document: { applyTextChange, focus, getValue: () => 'Saved' },
      enabled: true,
      onCandidate,
      onDiagnostic: vi.fn(),
      onStatus,
      storage: storage.port,
      strings
    });

    expect(onCandidate).toHaveBeenCalledWith(true);
    expect(session.restore()).toBe(true);
    expect(applyTextChange).toHaveBeenCalledWith({
      selection: { direction: 'none', end: 9, start: 9 },
      value: 'Recovered'
    });
    expect(focus).toHaveBeenCalledOnce();
    expect(onStatus).toHaveBeenCalledWith({ code: 'restored', message: 'Draft restored.', type: 'success' });

    storage.emit({ draft: createDraft('Other tab', 3000), source: 'current', status: 'available' });
    expect(session.discard()).toBe(true);
    expect(storage.port.discard).toHaveBeenCalledOnce();
    expect(onCandidate).toHaveBeenLastCalledWith(false);
    expect(onStatus).toHaveBeenCalledWith({ code: 'discarded', message: 'Draft discarded.', type: 'info' });
    session.dispose();
  });

  it('blocks pending writes when another tab publishes a different draft', () => {
    vi.useFakeTimers();
    const storage = createStorage();
    const onCandidate = vi.fn();
    const onStatus = vi.fn();
    const session = createLocalDraftSession({
      delayMs: 500,
      document: { applyTextChange: vi.fn(), focus: vi.fn(), getValue: () => 'Local edit' },
      enabled: true,
      onCandidate,
      onDiagnostic: vi.fn(),
      onStatus,
      storage: storage.port,
      strings
    });

    session.schedule();
    storage.emit({ draft: createDraft('Remote edit', 3000), source: 'current', status: 'available' });
    vi.advanceTimersByTime(500);

    expect(storage.port.write).not.toHaveBeenCalled();
    expect(onCandidate).toHaveBeenCalledWith(true);
    expect(onStatus).toHaveBeenCalledWith({ code: 'conflict', message: strings.conflict, type: 'error' });
    session.dispose();
    vi.useRealTimers();
  });

  it('blocks writes after a read failure until storage can be read safely again', () => {
    vi.useFakeTimers();
    const storage = createStorage({ code: 'local-draft-payload-invalid', status: 'failed' });
    const onDiagnostic = vi.fn();
    const onStatus = vi.fn();
    const session = createLocalDraftSession({
      delayMs: 500,
      document: { applyTextChange: vi.fn(), focus: vi.fn(), getValue: () => 'Local edit' },
      enabled: true,
      onCandidate: vi.fn(),
      onDiagnostic,
      onStatus,
      storage: storage.port,
      strings
    });

    expect(session.schedule()).toBe(false);
    vi.advanceTimersByTime(500);
    expect(storage.port.write).not.toHaveBeenCalled();
    expect(onDiagnostic).toHaveBeenCalledWith('local-draft-payload-invalid');
    expect(onStatus).toHaveBeenCalledWith({ code: 'read-failed', message: strings.readFailed, type: 'error' });

    storage.emit({ status: 'missing' });
    expect(session.schedule()).toBe(true);
    vi.advanceTimersByTime(500);
    expect(storage.port.write).toHaveBeenCalledOnce();
    session.dispose();
    vi.useRealTimers();
  });

  it('cancels pending work on disable and teardown without deleting recovery data', () => {
    vi.useFakeTimers();
    const storage = createStorage();
    const session = createLocalDraftSession({
      delayMs: 500,
      document: { applyTextChange: vi.fn(), focus: vi.fn(), getValue: () => 'draft' },
      enabled: true,
      onCandidate: vi.fn(),
      onDiagnostic: vi.fn(),
      onStatus: vi.fn(),
      storage: storage.port,
      strings
    });

    session.schedule();
    expect(session.setEnabled(false)).toBe(false);
    vi.advanceTimersByTime(500);
    expect(storage.port.write).not.toHaveBeenCalled();
    expect(storage.port.discard).not.toHaveBeenCalled();

    session.setEnabled(true);
    session.schedule();
    session.dispose();
    vi.advanceTimersByTime(500);
    expect(storage.port.write).not.toHaveBeenCalled();
    expect(session.schedule()).toBe(false);
    vi.useRealTimers();
  });

  it('removes only a draft proven equal to the authoritative saved fingerprint', () => {
    const matching = createDraft('Saved source');
    const storage = createStorage({ draft: matching, source: 'current', status: 'available' });
    const session = createLocalDraftSession({
      delayMs: 500,
      document: { applyTextChange: vi.fn(), focus: vi.fn(), getValue: () => 'Saved source' },
      enabled: true,
      onCandidate: vi.fn(),
      onDiagnostic: vi.fn(),
      onStatus: vi.fn(),
      savedFingerprint: matching.contentHash,
      storage: storage.port,
      strings
    });

    expect(session.reconcileSavedDraft()).toBe(true);
    expect(storage.port.discard).toHaveBeenCalledOnce();
    session.dispose();
  });
});
