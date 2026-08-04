import type { SettingsCenterApi, SettingsCenterSettings } from '../../../contracts/settings-center-settings';

export type SettingsCenterSettingsPort = Readonly<{
  save(settings: SettingsCenterSettings, signal: AbortSignal): Promise<SettingsCenterSettings>;
}>;

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function validSettings(value: unknown): value is SettingsCenterSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Number.isInteger(record.revision)
    && (record.revision as number) >= 0
    && ['general', 'images', 'markdown', 'shortcuts'].every((section) => (
      Boolean(record[section])
      && typeof record[section] === 'object'
      && !Array.isArray(record[section])
    ));
}

export function createWordPressSettingsPort(
  api: SettingsCenterApi,
  fetchLike: FetchLike = window.fetch.bind(window)
): SettingsCenterSettingsPort {
  let endpoint: URL;
  try {
    endpoint = new URL(api.settingsUrl, window.location.href);
  } catch {
    throw new Error('settings-center-api-url-invalid');
  }
  if (endpoint.origin !== window.location.origin || !api.nonce) {
    throw new Error('settings-center-api-transport-invalid');
  }

  return {
    async save(settings, signal) {
      let response: Response;
      try {
        response = await fetchLike(endpoint, {
          body: JSON.stringify({ settings }),
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/json',
            'X-WP-Nonce': api.nonce
          },
          method: 'POST',
          signal
        });
      } catch (error) {
        if (signal.aborted) throw error;
        throw new Error('settings-center-save-network-failed');
      }
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new Error('settings-center-save-response-invalid');
      }
      if (!response.ok) throw new Error('settings-center-save-rejected');
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new Error('settings-center-save-response-invalid');
      }
      const saved = (payload as Record<string, unknown>).settings;
      if (!validSettings(saved)) throw new Error('settings-center-save-response-invalid');
      return saved;
    }
  };
}
