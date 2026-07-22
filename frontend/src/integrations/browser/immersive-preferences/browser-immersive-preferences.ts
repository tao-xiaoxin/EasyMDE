import type {
  ImmersivePreferences,
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
      if (!storage) return null;
      try {
        const value = storage.getItem(key);
        if (null === value) return null;
        const parsed: unknown = JSON.parse(value);
        return isPreferences(parsed) ? parsed : null;
      } catch {
        return null;
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
