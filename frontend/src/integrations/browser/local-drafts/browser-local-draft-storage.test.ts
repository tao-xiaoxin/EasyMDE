import { describe, expect, it, vi } from 'vitest';

import { createBrowserLocalDraftStorage } from './browser-local-draft-storage';

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

const config = {
  locale: 'en_US',
  maxBytes: 1024,
  postId: 42,
  schemaVersion: 1 as const,
  siteKey: 'site',
  timeZone: 'UTC',
  userId: 7
};

describe('createBrowserLocalDraftStorage', () => {
  it('writes and reads a versioned draft under the scoped key', () => {
    const storage = createStorage();
    const drafts = createBrowserLocalDraftStorage({
      config,
      eventTarget: window,
      now: () => 1234,
      storage
    });

    expect(drafts.write('Draft body')).toEqual({ status: 'saved', updatedAt: 1234 });
    expect(storage.setItem).toHaveBeenCalledWith(
      'easymde:draft:v1:site:7:42',
      expect.stringContaining('"schemaVersion":1')
    );
    expect(drafts.read()).toEqual({
      draft: {
        content: 'Draft body',
        contentHash: drafts.fingerprint('Draft body'),
        schemaVersion: 1,
        updatedAt: 1234
      },
      source: 'current',
      status: 'available'
    });
  });

  it('reads an existing legacy draft without deleting it before a successful write', () => {
    const legacyKey = 'easymde:draft:site:7:42';
    const storage = createStorage();
    const drafts = createBrowserLocalDraftStorage({ config, eventTarget: window, now: () => 2000, storage });
    storage.setItem(
      legacyKey,
      JSON.stringify({
        content: 'Legacy draft',
        contentHash: drafts.fingerprint('Legacy draft'),
        updatedAt: 1000
      })
    );

    expect(drafts.read()).toMatchObject({ source: 'legacy', status: 'available' });
    expect(storage.removeItem).not.toHaveBeenCalledWith(legacyKey);

    expect(drafts.write('Migrated draft')).toEqual({ status: 'saved', updatedAt: 2000 });
    expect(storage.removeItem).toHaveBeenCalledWith(legacyKey);
  });

  it('selects a newer valid Legacy fallback draft when a stale versioned draft also exists', () => {
    const currentKey = 'easymde:draft:v1:site:7:42';
    const legacyKey = 'easymde:draft:site:7:42';
    const storage = createStorage();
    const drafts = createBrowserLocalDraftStorage({ config, eventTarget: window, now: () => 3000, storage });
    storage.setItem(currentKey, JSON.stringify({
      content: 'Older React recovery',
      contentHash: drafts.fingerprint('Older React recovery'),
      schemaVersion: 1,
      updatedAt: 1000
    }));
    storage.setItem(legacyKey, JSON.stringify({
      content: 'Newer Legacy recovery',
      contentHash: drafts.fingerprint('Newer Legacy recovery'),
      updatedAt: 2000
    }));

    expect(drafts.read()).toMatchObject({
      draft: { content: 'Newer Legacy recovery', updatedAt: 2000 },
      source: 'legacy',
      status: 'available'
    });
  });

  it('returns explicit failures for corrupt, oversized, and blocked storage', () => {
    const currentKey = 'easymde:draft:v1:site:7:42';
    const corrupt = createBrowserLocalDraftStorage({
      config,
      eventTarget: window,
      now: () => 1,
      storage: createStorage({ [currentKey]: '{' })
    });
    expect(corrupt.read()).toEqual({ code: 'local-draft-payload-invalid', status: 'failed' });

    const limited = createBrowserLocalDraftStorage({
      config: { ...config, maxBytes: 2 },
      eventTarget: window,
      now: () => 1,
      storage: createStorage()
    });
    expect(limited.write('too large')).toEqual({ code: 'local-draft-size-exceeded', status: 'failed' });

    const blockedStorage = createStorage();
    vi.mocked(blockedStorage.getItem).mockImplementation(() => {
      throw new Error('blocked');
    });
    const blocked = createBrowserLocalDraftStorage({
      config,
      eventTarget: window,
      now: () => 1,
      storage: blockedStorage
    });
    expect(blocked.read()).toEqual({ code: 'local-draft-read-failed', status: 'failed' });
  });

  it('subscribes only to the current and legacy draft keys and cleans up idempotently', () => {
    const drafts = createBrowserLocalDraftStorage({
      config,
      eventTarget: window,
      now: () => 1,
      storage: createStorage()
    });
    const listener = vi.fn();
    const unsubscribe = drafts.subscribe(listener);

    window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated' }));
    window.dispatchEvent(new StorageEvent('storage', { key: 'easymde:draft:v1:site:7:42' }));
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    unsubscribe();
    window.dispatchEvent(new StorageEvent('storage', { key: 'easymde:draft:site:7:42' }));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('formats WordPress fixed-offset time zones without treating them as IANA names', () => {
    const positiveOffsetDrafts = createBrowserLocalDraftStorage({
      config: { ...config, timeZone: '+08:00' },
      eventTarget: window,
      now: () => 1,
      storage: createStorage()
    });
    const negativeOffsetDrafts = createBrowserLocalDraftStorage({
      config: { ...config, timeZone: '-03:30' },
      eventTarget: window,
      now: () => 1,
      storage: createStorage()
    });

    expect(positiveOffsetDrafts.formatTime(Date.UTC(2026, 0, 1, 0, 30))).toEqual({
      status: 'formatted',
      value: '08:30 AM'
    });
    expect(negativeOffsetDrafts.formatTime(Date.UTC(2026, 0, 1, 0, 30))).toEqual({
      status: 'formatted',
      value: '09:00 PM'
    });
  });

  it.each([
    ['de_DE_formal', '08:30'],
    ['pt_PT_ao90', '08:30'],
    ['sr_RS_latin', '08:30']
  ])('normalizes the WordPress locale variant %s before formatting draft times', (locale, expected) => {
    const drafts = createBrowserLocalDraftStorage({
      config: { ...config, locale, timeZone: '+08:00' },
      eventTarget: window,
      now: () => 1,
      storage: createStorage()
    });

    expect(drafts.formatTime(Date.UTC(2026, 0, 1, 0, 30))).toEqual({
      status: 'formatted',
      value: expected
    });
  });

  it('reports sidecar failure without claiming the already stored recovery payload was lost', () => {
    const legacyKey = 'easymde:draft:site:7:42';
    const storage = createStorage({ [legacyKey]: '{}' });
    vi.mocked(storage.setItem).mockImplementationOnce(() => undefined).mockImplementationOnce(() => {
      throw new Error('quota');
    });
    const drafts = createBrowserLocalDraftStorage({ config, eventTarget: window, now: () => 1000, storage });

    expect(drafts.write('Recoverable')).toEqual({
      diagnostic: 'local-draft-hash-sidecar-write-failed',
      status: 'saved',
      updatedAt: 1000
    });
    expect(storage.removeItem).not.toHaveBeenCalledWith(legacyKey);
  });
});
