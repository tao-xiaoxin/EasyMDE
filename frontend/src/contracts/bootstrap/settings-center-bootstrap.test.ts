import { describe, expect, it } from 'vitest';

import {
  parseSettingsCenterBootstrap,
  SETTINGS_CENTER_STRING_KEYS
} from './settings-center-bootstrap';

function bootstrap(noSearchResults = 'No settings related to "%s" were found') {
  return {
    schemaVersion: 1,
    closeUrl: '/wp-admin/options-general.php?page=easymde',
    assets: {
      brandMarkUrl: '/plugin/brand.png',
      headerIllustrationUrl: '/plugin/header.png',
      searchEmptyIllustrationUrl: '/plugin/search-empty.png'
    },
    strings: {
      ...Object.fromEntries(SETTINGS_CENTER_STRING_KEYS.map((key) => [key, key])),
      searchPageDescription: 'Only settings matching "%s" are shown.',
      insertFileNameVariable: 'Insert %s variable',
      currentAllowedUploads: 'Currently allowed uploads: %s.',
      noSearchResults
    }
  };
}

describe('parseSettingsCenterBootstrap', () => {
  it('accepts exactly one search-query placeholder', () => {
    expect(parseSettingsCenterBootstrap(bootstrap()).strings.noSearchResults).toContain('%s');
  });

  it.each(['No matching settings found', '%s %s'])(
    'rejects an invalid search-query template: %s',
    (template) => {
      expect(() => parseSettingsCenterBootstrap(bootstrap(template))).toThrow(
        'settings-center-search-template-invalid'
      );
    }
  );

  it.each(['Only matching settings are shown.', '%s %s'])(
    'rejects an invalid search-page description template: %s',
    (template) => {
      const value = bootstrap();
      value.strings.searchPageDescription = template;
      expect(() => parseSettingsCenterBootstrap(value)).toThrow(
        'settings-center-search-description-template-invalid'
      );
    }
  );

  it.each([
    ['insertFileNameVariable', 'Insert variable'],
    ['currentAllowedUploads', '%s %s']
  ] as const)('rejects an invalid Images template for %s', (key, template) => {
    const value = bootstrap();
    value.strings[key] = template;
    expect(() => parseSettingsCenterBootstrap(value)).toThrow(
      `settings-center-${key}-template-invalid`
    );
  });
});
