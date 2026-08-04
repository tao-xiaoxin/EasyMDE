import { describe, expect, it, vi } from 'vitest';

import { SETTINGS_CENTER_TEST_SETTINGS } from '../../../test/settings-center-settings-fixture';
import { createWordPressSettingsPort } from './create-wordpress-settings-port';

describe('createWordPressSettingsPort', () => {
  it('posts settings through the same-origin REST contract and returns the saved state', async () => {
    const fetchLike = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.method).toBe('POST');
      expect(init?.credentials).toBe('same-origin');
      expect(new Headers(init?.headers).get('X-WP-Nonce')).toBe('test-nonce');
      expect(JSON.parse(String(init?.body))).toEqual({ settings: SETTINGS_CENTER_TEST_SETTINGS });
      return {
        ok: true,
        json: async () => ({ settings: SETTINGS_CENTER_TEST_SETTINGS })
      } as Response;
    });
    const port = createWordPressSettingsPort({
      settingsUrl: '/wp-json/easymde/v1/settings',
      nonce: 'test-nonce'
    }, fetchLike);

    await expect(port.save(SETTINGS_CENTER_TEST_SETTINGS, new AbortController().signal))
      .resolves.toEqual(SETTINGS_CENTER_TEST_SETTINGS);
    expect(fetchLike).toHaveBeenCalledOnce();
  });

  it('rejects cross-origin endpoints before making a request', () => {
    expect(() => createWordPressSettingsPort({
      settingsUrl: 'https://settings.example.test/wp-json/easymde/v1/settings',
      nonce: 'test-nonce'
    }, vi.fn())).toThrow('settings-center-api-transport-invalid');
  });

  it('reports a failed server response instead of claiming persistence', async () => {
    const port = createWordPressSettingsPort({
      settingsUrl: '/wp-json/easymde/v1/settings',
      nonce: 'test-nonce'
    }, vi.fn(async () => ({
      ok: false,
      json: async () => ({ code: 'easymde_settings_invalid_payload' })
    } as Response)));

    await expect(port.save(SETTINGS_CENTER_TEST_SETTINGS, new AbortController().signal))
      .rejects.toThrow('settings-center-save-rejected');
  });
});
