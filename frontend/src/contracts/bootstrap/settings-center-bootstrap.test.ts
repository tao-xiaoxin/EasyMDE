import { describe, expect, it } from 'vitest';

import {
  parseSettingsCenterBootstrap,
  SETTINGS_CENTER_STRING_KEYS
} from './settings-center-bootstrap';
import {
  SETTINGS_CENTER_DEFAULT_SETTINGS,
  SETTINGS_CENTER_TEST_SETTINGS
} from '../../test/settings-center-settings-fixture';
function bootstrap(noSearchResults = 'No settings related to "%s" were found') {
  return {
    schemaVersion: 2,
    closeUrl: '/wp-admin/options-general.php?page=easymde',
    api: { settingsUrl: '/wp-json/easymde/v1/settings', nonce: 'test-nonce' },
    assets: {
      brandMarkUrl: '/plugin/brand.png',
      headerIllustrationUrl: '/plugin/header.png',
      searchEmptyIllustrationUrl: '/plugin/search-empty.png'
    },
    drafts: {
      images: {
        domain: 'https://img.example.test',
        backupDomain: 'https://backup.example.test'
      }
    },
    settings: SETTINGS_CENTER_TEST_SETTINGS,
    defaultSettings: SETTINGS_CENTER_DEFAULT_SETTINGS,
    strings: {
      ...Object.fromEntries(SETTINGS_CENTER_STRING_KEYS.map((key) => [key, key])),
      searchPageDescription: 'Only settings matching "%s" are shown.',
      searchResultCount: '%s items',
      insertFileNameVariable: 'Insert %s variable',
      currentAllowedUploads: 'Currently allowed uploads: %s.',
      editPrompt: 'Edit %s',
      duplicatePrompt: 'Duplicate %s',
      deletePrompt: 'Delete %s',
      promptCategoryEmpty: 'No prompts in %s',
      promptPaginationSummary: 'Total %1$s, page %2$s / %3$s',
      deletePromptConfirmation: 'Delete %s?',
      promptCreated: 'Created %s',
      promptSaved: 'Saved %s',
      promptDuplicated: 'Duplicated %s',
      promptDeleted: 'Deleted %s',
      promptImportSuccess: 'Imported %s prompts',
      aiConnectionSuccess: '%1$s connection is normal; model %2$s is available.',
      aiConnectionTesting: 'Testing %s connection...',
      syncPlatformDialogTitle: '%s Platform Management',
      syncPlatformRevoked: '%s authorization revoked',
      syncTargetPlatformCount: '%s target platforms',
      syncHistorySummary: 'A total of %1$s entries, page %2$s of %3$s',
      transferFileSelectedNotice: 'Selected %s',
      transferChecksSummary: '%s key configuration items checked',
      transferChecksPassed: '%s items passed',
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

  it.each(['Items', '%s %s'])(
    'rejects an invalid search-result count template: %s',
    (template) => {
      const value = bootstrap();
      value.strings.searchResultCount = template;
      expect(() => parseSettingsCenterBootstrap(value)).toThrow(
        'settings-center-search-result-count-template-invalid'
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


  it('rejects an invalid selected Transfer file template', () => {
    const value = bootstrap();
    value.strings.transferFileSelectedNotice = 'Selected configuration file';
    expect(() => parseSettingsCenterBootstrap(value)).toThrow(
      'settings-center-transferFileSelectedNotice-template-invalid'
    );
  });

  it.each([
    'transferChecksSummary',
    'transferChecksPassed'
  ] as const)('rejects an invalid Transfer check template for %s', (key) => {
    const value = bootstrap();
    value.strings[key] = 'Missing count';
    expect(() => parseSettingsCenterBootstrap(value)).toThrow(
      `settings-center-${key}-template-invalid`
    );
  });
  it('accepts empty optional image domains from the live defaults', () => {
    const value = bootstrap();
    value.drafts.images.domain = '';
    value.drafts.images.backupDomain = '';

    expect(parseSettingsCenterBootstrap(value).drafts.images).toEqual({
      domain: '',
      backupDomain: ''
    });
  });
});
