import { describe, expect, it } from 'vitest';

import {
  parseSettingsCenterBootstrap,
  SETTINGS_CENTER_STRING_KEYS
} from './settings-center-bootstrap';

function bootstrap(noSearchResults = 'No settings related to "%s" were found') {
  return {
    schemaVersion: 2,
    closeUrl: '/wp-admin/options-general.php?page=easymde',
    settings: {
      optionKey: 'easymde_editor_settings',
      toolbarLayout: 'hybrid-icons',
      shortcuts: {
        bold: { win: 'Ctrl+B', mac: 'Cmd+B' }
      }
    },
    commands: [{
      id: 'bold',
      label: 'Bold',
      group: 'format',
      defaultShortcutWin: 'Ctrl+B',
      defaultShortcutMac: 'Cmd+B'
    }],
    assets: {
      brandMarkUrl: '/plugin/brand.png',
      headerIllustrationUrl: '/plugin/header.png',
      searchEmptyIllustrationUrl: '/plugin/search-empty.png'
    },
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
      transferFileSelectedNotice: 'Selected %s',
      transferChecksSummary: '%s key configuration items checked',
      transferChecksPassed: '%s items passed',
      noSearchResults
    }
  };
}

describe('parseSettingsCenterBootstrap', () => {
  it('accepts real editor settings and commands', () => {
    const parsed = parseSettingsCenterBootstrap(bootstrap());

    expect(parsed.settings.optionKey).toBe('easymde_editor_settings');
    expect(parsed.settings.shortcuts.bold?.win).toBe('Ctrl+B');
    expect(parsed.commands[0]?.id).toBe('bold');
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

  it('rejects a toolbar layout that the PHP owner does not support', () => {
    const value = bootstrap();
    value.settings.toolbarLayout = 'custom';
    expect(() => parseSettingsCenterBootstrap(value)).toThrow(
      'settings-center-toolbar-layout-unsupported'
    );
  });

  it('rejects a malformed shortcut value', () => {
    const value = bootstrap();
    value.settings.shortcuts.bold = { win: 'Ctrl+B', mac: undefined as unknown as string };
    expect(() => parseSettingsCenterBootstrap(value)).toThrow(
      'settings-center-shortcut-bold-mac-invalid'
    );
  });

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

  it.each([
    'transferFileSelectedNotice',
    'transferChecksSummary',
    'transferChecksPassed'
  ] as const)('rejects an invalid Transfer template for %s', (key) => {
    const value = bootstrap();
    value.strings[key] = 'Missing count';
    expect(() => parseSettingsCenterBootstrap(value)).toThrow(
      `settings-center-${key}-template-invalid`
    );
  });
});
