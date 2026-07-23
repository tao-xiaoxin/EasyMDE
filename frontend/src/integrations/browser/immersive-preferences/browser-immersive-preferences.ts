import type {
  ImmersivePreferences,
  ImmersivePreferencesReadResult,
  ImmersivePreferencesPort,
  ImmersivePreferencesWriteResult
} from '../../../contracts/ports/immersive-preferences-port';

type Options = Readonly<{
  siteKey: string;
  storage: Storage | null;
  userId: number;
}>;

const isPreferences = (value: unknown): value is ImmersivePreferences => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return [
    'autoSave',
    'outline',
    'splitPreview',
    'syncScroll',
    'wordCount'
  ].every((key) => typeof candidate[key] === 'boolean');
};

export function createBrowserImmersivePreferencesPort({
  siteKey,
  storage,
  userId
}: Options): ImmersivePreferencesPort {
  const key = `easymde:immersive-preferences:v1:${siteKey}:${userId}`;

  return {
    read() {
      if (!storage) return { code: 'immersive-preferences-storage-unavailable', status: 'failed' } satisfies ImmersivePreferencesReadResult;
      try {
        const value = storage.getItem(key);
        if (null === value) return { status: 'missing' };
        const parsed: unknown = JSON.parse(value);
        if (!isPreferences(parsed)) {
          return { code: 'immersive-preferences-invalid', status: 'failed' };
        }
        return { preferences: parsed, status: 'loaded' };
      } catch {
        return { code: 'immersive-preferences-read-failed', status: 'failed' };
      }
    },
    write(preferences): ImmersivePreferencesWriteResult {
      if (!storage) return { code: 'immersive-preferences-storage-unavailable', status: 'unavailable' };
      try {
        storage.setItem(key, JSON.stringify(preferences));
        return { status: 'saved' };
      } catch {
        return { code: 'immersive-preferences-write-failed', status: 'unavailable' };
      }
    }
  };
}
