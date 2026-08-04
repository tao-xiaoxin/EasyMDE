import { createRoot } from '@wordpress/element';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  parseSettingsCenterBootstrap,
  SETTINGS_CENTER_STRING_KEYS,
  type SettingsCenterBootstrap
} from '../contracts/bootstrap/settings-center-bootstrap';
import {
  SETTINGS_CENTER_DEFAULT_SETTINGS,
  SETTINGS_CENTER_TEST_SETTINGS
} from '../test/settings-center-settings-fixture';
import { mountSettingsCenter } from './settings-center';

vi.hoisted(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

vi.mock('@wordpress/element', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@wordpress/element')>()),
  createRoot: vi.fn()
}));
vi.mock('../contracts/bootstrap/settings-center-bootstrap', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../contracts/bootstrap/settings-center-bootstrap')>()),
  parseSettingsCenterBootstrap: vi.fn()
}));

function bootstrap(): SettingsCenterBootstrap {
  const origin = window.location.origin;
  return {
    schemaVersion: 2,
    closeUrl: `${origin}/wp-admin/options-general.php?page=easymde`,
    api: { settingsUrl: `${origin}/wp-json/easymde/v1/settings`, nonce: 'test-nonce' },
    assets: {
      brandMarkUrl: `${origin}/plugin/brand.png`,
      headerIllustrationUrl: `${origin}/plugin/header.png`,
      searchEmptyIllustrationUrl: `${origin}/plugin/search-empty.png`
    },
    drafts: {
      images: {
        domain: 'https://img.example.test',
        backupDomain: 'https://backup.example.test'
      },
    },
    settings: SETTINGS_CENTER_TEST_SETTINGS,
    defaultSettings: SETTINGS_CENTER_DEFAULT_SETTINGS,
    strings: Object.fromEntries(
      SETTINGS_CENTER_STRING_KEYS.map((key) => [key, key])
    ) as SettingsCenterBootstrap['strings']
  };
}

describe('mountSettingsCenter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '<div id="easymde-settings-center-root"></div>';
    vi.mocked(parseSettingsCenterBootstrap).mockReturnValue(bootstrap());
  });

  it('mounts one independent root and returns idempotent teardown', () => {
    const render = vi.fn();
    const unmount = vi.fn();
    vi.mocked(createRoot).mockReturnValue({ render, unmount } as never);

    const teardown = mountSettingsCenter({}, { document, window });

    expect(parseSettingsCenterBootstrap).toHaveBeenCalledWith({});
    expect(createRoot).toHaveBeenCalledWith(
      document.querySelector('#easymde-settings-center-root')
    );
    expect(render).toHaveBeenCalledOnce();
    teardown();
    teardown();
    expect(unmount).toHaveBeenCalledOnce();
  });

  it('rejects cross-origin navigation', () => {
    vi.mocked(parseSettingsCenterBootstrap).mockReturnValue({
      ...bootstrap(),
      closeUrl: 'https://invalid.test/wp-admin/options-general.php?page=easymde'
    });

    expect(() => mountSettingsCenter({}, { document, window })).toThrow(
      'settings-center-url-origin-invalid'
    );
    expect(createRoot).not.toHaveBeenCalled();
  });

  it('accepts WordPress asset URLs served from a configured content origin', () => {
    const render = vi.fn();
    vi.mocked(createRoot).mockReturnValue({ render, unmount: vi.fn() } as never);
    vi.mocked(parseSettingsCenterBootstrap).mockReturnValue({
      ...bootstrap(),
      assets: {
        brandMarkUrl: 'https://static.example.test/plugin/brand.png',
        headerIllustrationUrl: 'https://static.example.test/plugin/header.png',
        searchEmptyIllustrationUrl: 'https://static.example.test/plugin/search-empty.png'
      }
    });

    expect(() => mountSettingsCenter({}, { document, window })).not.toThrow();
    expect(render).toHaveBeenCalledOnce();
  });
});
