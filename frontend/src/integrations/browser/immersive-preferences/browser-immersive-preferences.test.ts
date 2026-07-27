import { describe, expect, it } from 'vitest';
import { createBrowserImmersivePreferencesPort } from './browser-immersive-preferences';

const preferences = {
  autoSave: false,
  outline: true,
  splitPreview: false,
  syncScroll: true,
  wordCount: false
} as const;

describe('browser immersive preferences', () => {
  it('scopes preferences by site and user and restores valid values', () => {
    const storage = new Map<string, string>();
    const adapter: Storage = {
      get length() { return storage.size; },
      clear: () => storage.clear(),
      getItem: (key) => storage.get(key) ?? null,
      key: (index) => [...storage.keys()][index] ?? null,
      removeItem: (key) => storage.delete(key),
      setItem: (key, value) => void storage.set(key, value)
    };
    const first = createBrowserImmersivePreferencesPort({ siteKey: 'site-a', storage: adapter, userId: 7 });
    const otherUser = createBrowserImmersivePreferencesPort({ siteKey: 'site-a', storage: adapter, userId: 8 });
    expect(first.read()).toEqual({ status: 'missing' });
    expect(first.write(preferences)).toEqual({ status: 'saved' });
    expect(first.read()).toEqual({ preferences, status: 'loaded' });
    expect(otherUser.read()).toEqual({ status: 'missing' });
  });

  it('rejects malformed values without exposing them to the UI', () => {
    const storage = new Map<string, string>([['easymde:immersive-preferences:v1:site-a:7', '{"outline":"yes"}']]);
    const adapter = { getItem: (key: string) => storage.get(key) ?? null } as Storage;
    expect(createBrowserImmersivePreferencesPort({ siteKey: 'site-a', storage: adapter, userId: 7 }).read()).toEqual({ code: 'immersive-preferences-invalid', status: 'failed' });
  });

  it('reports storage read failures instead of treating them as missing', () => {
    const adapter = {
      getItem: () => {
        throw new Error('blocked');
      }
    } as unknown as Storage;
    expect(createBrowserImmersivePreferencesPort({ siteKey: 'site-a', storage: adapter, userId: 7 }).read()).toEqual({ code: 'immersive-preferences-read-failed', status: 'failed' });
  });
});
