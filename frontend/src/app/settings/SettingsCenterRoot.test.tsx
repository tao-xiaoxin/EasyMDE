import { createElement } from '@wordpress/element';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import {
  SETTINGS_CENTER_STRING_KEYS,
  type SettingsCenterBootstrap
} from '../../contracts/bootstrap/settings-center-bootstrap';
import type { SettingsCenterSettings } from '../../contracts/settings-center-settings';
import {
  SETTINGS_CENTER_DEFAULT_SETTINGS,
  SETTINGS_CENTER_TEST_SETTINGS
} from '../../test/settings-center-settings-fixture';
import { SettingsCenterRoot } from './SettingsCenterRoot';

function bootstrap(): SettingsCenterBootstrap {
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
      },
    },
    settings: SETTINGS_CENTER_TEST_SETTINGS,
    defaultSettings: SETTINGS_CENTER_DEFAULT_SETTINGS,
    strings: {
      ...Object.fromEntries(SETTINGS_CENTER_STRING_KEYS.map((key) => [key, key])),
      editPrompt: 'editPrompt %s',
      duplicatePrompt: 'duplicatePrompt %s',
      deletePrompt: 'deletePrompt %s',
      promptCategoryEmpty: 'promptCategoryEmpty %s',
      promptPaginationSummary: 'promptPaginationSummary %1$s %2$s %3$s',
      deletePromptConfirmation: 'deletePromptConfirmation %s',
      promptCreated: 'promptCreated %s',
      promptSaved: 'promptSaved %s',
      promptDuplicated: 'promptDuplicated %s',
      promptDeleted: 'promptDeleted %s',
      promptImportSuccess: 'promptImportSuccess %s',
      transferFileSelectedNotice: 'transferFileSelectedNotice %s',
      syncMoreActions: 'syncMoreActions %s',
      syncPlatformDialogTitle: 'syncPlatformDialogTitle %s',
      syncPlatformRevoked: 'syncPlatformRevoked %s',
      syncTargetPlatformCount: 'syncTargetPlatformCount %s',
      syncHistorySummary: 'syncHistorySummary %1$s %2$s %3$s'
    } as SettingsCenterBootstrap['strings']
  };
}

describe('SettingsCenterRoot global search', () => {
  it('indexes and opens results from sections beyond General', async () => {
    const user = userEvent.setup();
    render(<SettingsCenterRoot bootstrap={bootstrap()} />);
    const search = screen.getByRole<HTMLInputElement>('searchbox', {
      name: 'searchSettings'
    });

    await user.type(search, 'tableAlignment');

    const result = await screen.findByRole('button', { name: 'tableAlignment' });
    expect(screen.getByRole('button', { name: 'markdown' }).getAttribute('aria-current'))
      .toBe('page');
    await user.click(result);

    expect(search.value).toBe('');
    expect(screen.getByText('tableAlignment')).not.toBeNull();
  });

  it('reports no results only after searching the complete settings index', async () => {
    const user = userEvent.setup();
    render(<SettingsCenterRoot bootstrap={bootstrap()} />);

    await user.type(screen.getByRole('searchbox', { name: 'searchSettings' }), 'not-a-setting');

    expect(await screen.findByRole('heading', {
      name: 'noSearchResults'
    })).not.toBeNull();
  });

  it('removes conditionally unmounted settings from the search index', async () => {
    const user = userEvent.setup();
    render(<SettingsCenterRoot bootstrap={bootstrap()} />);

    await user.click(screen.getByRole('switch', { name: 'enableBackupImageHost' }));
    await user.type(screen.getByRole('searchbox', { name: 'searchSettings' }), 'backupBucket');

    expect(await screen.findByRole('heading', {
      name: 'noSearchResults'
    })).not.toBeNull();
  });

  it('cancels pending result navigation when the settings root unmounts', async () => {
    const user = userEvent.setup();
    const requestAnimationFrame = vi.spyOn(window, 'requestAnimationFrame')
      .mockReturnValue(41);
    const cancelAnimationFrame = vi.spyOn(window, 'cancelAnimationFrame')
      .mockImplementation(() => undefined);
    const { unmount } = render(<SettingsCenterRoot bootstrap={bootstrap()} />);

    await user.type(screen.getByRole('searchbox', { name: 'searchSettings' }), 'tableAlignment');
    await user.click(await screen.findByRole('button', { name: 'tableAlignment' }));
    expect(requestAnimationFrame).toHaveBeenCalledOnce();

    unmount();
    expect(cancelAnimationFrame).toHaveBeenCalledWith(41);
    requestAnimationFrame.mockRestore();
    cancelAnimationFrame.mockRestore();
  });
});

describe('SettingsCenterRoot shortcuts section', () => {
  it('renders General and Shortcuts as consecutive settings sections', () => {
    const { container } = render(<SettingsCenterRoot bootstrap={bootstrap()} />);
    const sections = Array.from(container.querySelectorAll('[data-settings-section]'));

    expect(sections.slice(0, 2).map((section) => section.getAttribute('data-settings-section')))
      .toEqual(['general', 'shortcuts']);
    expect(screen.getByRole('heading', { name: 'commonShortcuts' })).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'headingAndFormatting' })).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'shortcutBehavior' })).not.toBeNull();
  });

  it('edits a platform shortcut locally and restores every shortcut default', async () => {
    const user = userEvent.setup();
    render(<SettingsCenterRoot bootstrap={bootstrap()} />);
    const windowsSave = screen.getByRole<HTMLInputElement>('textbox', {
      name: 'saveArticle windowsLinux'
    });
    const macSave = screen.getByRole<HTMLInputElement>('textbox', { name: 'saveArticle macOS' });

    expect(windowsSave.value).toBe('Ctrl+S');
    expect(macSave.value).toBe('Cmd+S');
    await user.clear(windowsSave);
    await user.type(windowsSave, 'Ctrl+Shift+S');
    expect(windowsSave.value).toBe('Ctrl+Shift+S');

    await user.click(screen.getByRole('button', { name: 'restoreDefaultShortcuts' }));
    expect(windowsSave.value).toBe('Ctrl+S');
    expect(macSave.value).toBe('Cmd+S');
  });

  it('keeps shortcut behavior switches in browser-session state', async () => {
    const user = userEvent.setup();
    render(<SettingsCenterRoot bootstrap={bootstrap()} />);
    const behavior = screen.getByRole('heading', { name: 'shortcutBehavior' }).closest('section');
    if (!behavior) throw new Error('shortcut-behavior-section-missing');
    const hints = within(behavior).getByRole('switch', { name: 'showShortcutHints' });

    expect(hints.getAttribute('aria-checked')).toBe('true');
    await user.click(hints);
    expect(hints.getAttribute('aria-checked')).toBe('false');
  });
});

describe('SettingsCenterRoot images section', () => {
  it('renders the Images groups after Shortcuts in the continuous settings card', () => {
    const { container } = render(<SettingsCenterRoot bootstrap={bootstrap()} />);
    const sections = Array.from(container.querySelectorAll('[data-settings-section]'));

    expect(sections.slice(0, 3).map((section) => section.getAttribute('data-settings-section')))
      .toEqual(['general', 'shortcuts', 'images']);
    expect(screen.getByRole('heading', { name: 'imageHostService' })).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'backupImageHost' })).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'uploadBehavior' })).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'defaultInsertion' })).not.toBeNull();
  });

  it('keeps backup image-host fields conditional and session-only', async () => {
    const user = userEvent.setup();
    render(<SettingsCenterRoot bootstrap={bootstrap()} />);
    const backup = screen.getByRole('switch', { name: 'enableBackupImageHost' });

    expect(screen.getByRole('textbox', { name: 'backupBucket' })).not.toBeNull();
    await user.click(backup);
    expect(screen.queryByRole('textbox', { name: 'backupBucket' })).toBeNull();
    await user.click(backup);
    expect(screen.getByRole('textbox', { name: 'backupBucket' })).not.toBeNull();
  });

  it('shows pending image-host connection states without claiming a result', () => {
    render(<SettingsCenterRoot bootstrap={bootstrap()} />);
    const imagesSection = screen.getByRole('heading', { name: 'imageHostService' })
      .closest('[data-settings-section="images"]');
    if (!(imagesSection instanceof HTMLElement)) throw new Error('images-settings-section-missing');
    const images = within(imagesSection);

    const primaryTest = images.getByRole<HTMLButtonElement>('button', {
      name: 'testConnection'
    });
    const backupTest = images.getByRole<HTMLButtonElement>('button', {
      name: 'testBackupConnection'
    });

    expect(primaryTest.disabled).toBe(true);
    expect(backupTest.disabled).toBe(true);
    expect(images.getAllByText('pendingTest')).toHaveLength(2);
    expect(images.queryByText('connected')).toBeNull();
    expect(images.queryByText('lastTest')).toBeNull();
  });

  it('edits the filename rule from presets and upload formats locally', async () => {
    const user = userEvent.setup();
    render(<SettingsCenterRoot bootstrap={bootstrap()} />);
    const rule = screen.getByRole<HTMLInputElement>('textbox', { name: 'fileNameRule' });
    const gif = screen.getByRole('checkbox', { name: 'allowUploadGif' });

    expect(rule.value).toBe('{date}/{uuid}.{ext}');
    await user.click(screen.getByRole('button', { name: 'fileNamePresetMd5' }));
    expect(rule.value).toBe('{year}/{month}/{md5}.{ext}');
    expect((gif as HTMLInputElement).checked).toBe(true);
    await user.click(gif);
    expect((gif as HTMLInputElement).checked).toBe(false);
  });
  it('uses stable IDs instead of translated labels for persisted selects', async () => {
    const user = userEvent.setup();
    render(<SettingsCenterRoot bootstrap={bootstrap()} />);
    const service = screen.getByRole<HTMLSelectElement>('combobox', {
      name: 'selectImageHostService'
    });
    const theme = screen.getByRole<HTMLSelectElement>('combobox', { name: 'editorTheme' });

    expect(service.value).toBe('cloudflare-r2');
    expect(theme.value).toBe('system');
    await user.selectOptions(service, 'aliyun-oss');
    await user.selectOptions(theme, 'dark');
    expect(service.value).toBe('aliyun-oss');
    expect(theme.value).toBe('dark');
  });
});


describe('SettingsCenterRoot Markdown section', () => {
  it('renders every Markdown group after Images in the continuous settings card', () => {
    const { container } = render(<SettingsCenterRoot bootstrap={bootstrap()} />);
    const sections = Array.from(container.querySelectorAll('[data-settings-section]'));

    expect(sections.slice(0, 4).map((section) => section.getAttribute('data-settings-section')))
      .toEqual(['general', 'shortcuts', 'images', 'markdown']);
    expect(screen.getByRole('heading', { name: 'markdownEditorSettings' })).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'markdownParsingRendering' })).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'markdownExtensions' })).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'otherSettings' })).not.toBeNull();
  });

  it('keeps Markdown controls in browser-session state', async () => {
    const user = userEvent.setup();
    render(<SettingsCenterRoot bootstrap={bootstrap()} />);
    const markdown = document.querySelector('[data-settings-section="markdown"]');
    if (!(markdown instanceof HTMLElement)) throw new Error('markdown-settings-section-missing');
    const controls = within(markdown);
    const lineNumbers = controls.getByRole('switch', { name: 'showLineNumbers' });
    const theme = controls.getByRole<HTMLSelectElement>('combobox', { name: 'editorTheme' });
    const unorderedMarker = controls.getByRole<HTMLInputElement>('textbox', {
      name: 'unorderedListMarker'
    });

    expect(lineNumbers.getAttribute('aria-checked')).toBe('false');
    await user.click(lineNumbers);
    expect(lineNumbers.getAttribute('aria-checked')).toBe('true');
    await user.selectOptions(theme, 'dark');
    expect(theme.value).toBe('dark');
    await user.clear(unorderedMarker);
    await user.type(unorderedMarker, '*');
    expect(unorderedMarker.value).toBe('*');
  });
});


describe('SettingsCenterRoot Transfer section', () => {
  it('renders the complete Transfer groups after Markdown instead of a placeholder', () => {
    const { container } = render(<SettingsCenterRoot bootstrap={bootstrap()} />);
    const sections = Array.from(container.querySelectorAll('[data-settings-section]'));

    expect(sections.slice(0, 5).map((section) => section.getAttribute('data-settings-section')))
      .toEqual(['general', 'shortcuts', 'images', 'markdown', 'transfer']);
    expect(screen.getByRole('heading', { name: 'transferExportConfiguration' })).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'transferImportConfiguration' })).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'transferConfigurationManagement' })).not.toBeNull();
  });

  it('keeps filename and selected import file in browser-session state', async () => {
    const user = userEvent.setup();
    const { container } = render(<SettingsCenterRoot bootstrap={bootstrap()} />);
    const transferSection = container.querySelector('[data-settings-section="transfer"]');
    if (!(transferSection instanceof HTMLElement)) throw new Error('settings-center-transfer-section-missing');
    const transfer = within(transferSection);
    const fileName = transfer.getByRole<HTMLInputElement>('textbox', {
      name: 'transferExportFileName'
    });
    const fileInput = transfer.getByLabelText<HTMLInputElement>('transferChooseConfigurationFile');

    await user.clear(fileName);
    await user.type(fileName, 'easymde-visual-audit');
    expect(fileName.value).toBe('easymde-visual-audit');

    await user.upload(fileInput, new File(['{}'], 'settings.json', {
      type: 'application/json'
    }));
    expect(transfer.getByText('settings.json')).not.toBeNull();
    expect(transfer.getByRole('button', { name: 'transferConfirmImport' })).not.toBeNull();
    expect(screen.getByRole('status').textContent)
      .toContain('transferFileSelectedNotice settings.json');
  });

  it('exports the current draft and imports a validated configuration into the draft', async () => {
    const user = userEvent.setup();
    const { container } = render(<SettingsCenterRoot bootstrap={bootstrap()} />);
    const transferSection = container.querySelector('[data-settings-section="transfer"]');
    if (!(transferSection instanceof HTMLElement)) throw new Error('settings-center-transfer-section-missing');
    const transfer = within(transferSection);
    const fileInput = transfer.getByLabelText<HTMLInputElement>('transferChooseConfigurationFile');
    const createObjectUrl = vi.fn((value: Blob) => {
      void value;
      return 'blob:settings-center';
    });
    const revokeObjectUrl = vi.fn();
    const originalCreateObjectUrl = URL.createObjectURL;
    const originalRevokeObjectUrl = URL.revokeObjectURL;
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectUrl });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectUrl });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    try {
      await user.click(transfer.getByRole('button', { name: /transferExportConfiguration/ }));
      expect(within(container).getByRole('status').textContent).toContain('transferExportSuccess');
      const calls = createObjectUrl.mock.calls as ReadonlyArray<Readonly<[Blob]>>;
      const firstCall = calls[0];
      if (!firstCall) throw new Error('settings-center-export-blob-missing');
      const exported = JSON.parse(await firstCall[0].text()) as {
        schemaVersion: number;
        settings: SettingsCenterSettings;
      };
      expect(exported.schemaVersion).toBe(1);
      expect(exported.settings.general.autoFocusEditor).toBe(true);
      expect(click).toHaveBeenCalledOnce();

      const imported = {
        ...bootstrap().settings,
        general: { ...bootstrap().settings.general, autoFocusEditor: false }
      };
      await user.upload(fileInput, new File([
        JSON.stringify({ schemaVersion: 1, settings: imported })
      ], 'import.json', { type: 'application/json' }));
      await user.click(transfer.getByRole('button', { name: 'transferConfirmImport' }));
      await waitFor(() => expect(screen.getByRole('switch', { name: 'autoFocusEditor' })
        .getAttribute('aria-checked')).toBe('false'));
      expect(within(container).getByRole('status').textContent).toContain('transferImportApplied');
    } finally {
      Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: originalCreateObjectUrl });
      Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: originalRevokeObjectUrl });
      click.mockRestore();
    }
  });

  it('resets the browser draft to defaults and reports the applied change', async () => {
    const user = userEvent.setup();
    const { container } = render(<SettingsCenterRoot bootstrap={bootstrap()} />);
    const overlayRoot = container.querySelector('[data-settings-overlay-root]');
    if (!(overlayRoot instanceof HTMLElement)) throw new Error('settings-center-overlay-missing');

    const autoFocus = screen.getByRole('switch', { name: 'autoFocusEditor' });
    await user.click(autoFocus);
    expect(autoFocus.getAttribute('aria-checked')).toBe('false');
    await user.click(screen.getByRole('button', { name: /transferResetCurrentConfiguration/ }));
    const dialog = within(overlayRoot).getByRole('dialog', {
      name: 'transferResetCurrentConfiguration'
    });
    expect(within(dialog).getByText('transferResetWarning')).not.toBeNull();

    await user.click(within(dialog).getByRole('button', { name: 'transferConfirmReset' }));
    expect(autoFocus.getAttribute('aria-checked')).toBe('true');
    expect(within(overlayRoot).getByRole('status').textContent)
      .toContain('transferResetApplied');
  });

  it('shows truthful storage and configuration checks in operation dialogs', async () => {
    const user = userEvent.setup();
    const { container } = render(<SettingsCenterRoot bootstrap={bootstrap()} />);
    const overlayRoot = container.querySelector('[data-settings-overlay-root]');
    if (!(overlayRoot instanceof HTMLElement)) throw new Error('settings-center-overlay-missing');

    await user.click(screen.getByRole('button', {
      name: /transferOpenConfigurationDirectory/
    }));
    const directoryDialog = within(overlayRoot).getByRole('dialog', {
      name: 'transferConfigurationDirectory'
    });
    expect(within(directoryDialog).getByText('transferStorageLocationValue')).not.toBeNull();
    await user.click(within(directoryDialog).getByRole('button', {
      name: 'transferCopyStorageLocation'
    }));
    expect(within(overlayRoot).getByRole('status').textContent)
      .toContain('transferStorageLocationCopied');

    await user.click(within(directoryDialog).getByRole('button', {
      name: 'transferCloseOperationDialog'
    }));
    await user.click(screen.getByRole('button', {
      name: /transferViewConfigurationStatus/
    }));
    const statusDialog = within(overlayRoot).getByRole('dialog', {
      name: 'transferConfigurationStatusCheck'
    });
    expect(within(statusDialog).getByText('transferCheckBootstrap')).not.toBeNull();
    expect(within(statusDialog).getByText('transferCheckPersistenceReady')).not.toBeNull();
  });
});

describe('SettingsCenterRoot About section', () => {
  it('renders every About group after Transfer instead of a placeholder', () => {
    const { container } = render(<SettingsCenterRoot bootstrap={bootstrap()} />);
    const sections = Array.from(container.querySelectorAll('[data-settings-section]'));

    expect(sections.map((section) => section.getAttribute('data-settings-section')))
      .toEqual(['general', 'shortcuts', 'images', 'markdown', 'transfer', 'about']);
    expect(screen.getByRole('heading', { name: 'aboutVersionInformation' })).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'aboutCoreCapabilities' })).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'aboutResourcesSupport' })).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'aboutPluginIntroduction' })).not.toBeNull();
  });

  it('reports unavailable About actions without navigating or claiming success', async () => {
    const user = userEvent.setup();
    const { container } = render(<SettingsCenterRoot bootstrap={bootstrap()} />);
    const overlayRoot = container.querySelector('[data-settings-overlay-root]');
    if (!(overlayRoot instanceof HTMLElement)) throw new Error('settings-center-overlay-missing');

    await user.click(screen.getByRole('button', { name: 'aboutCheckUpdates' }));
    const feedback = within(overlayRoot).getByRole('status');
    expect(feedback.textContent).toContain('aboutActionPendingNotice');
  });

  it('opens truthful Help and Changelog dialogs and restores trigger focus', async () => {
    const user = userEvent.setup();
    const { container } = render(<SettingsCenterRoot bootstrap={bootstrap()} />);
    const overlayRoot = container.querySelector('[data-settings-overlay-root]');
    if (!(overlayRoot instanceof HTMLElement)) throw new Error('settings-center-overlay-missing');

    const documentation = screen.getByRole('button', { name: /aboutOfficialDocumentation/ });
    await user.click(documentation);
    const helpDialog = within(overlayRoot).getByRole('dialog', {
      name: 'aboutHelpDialogTitle'
    });
    expect(within(helpDialog).getByText('aboutHelpEditorWorkflowDescription')).not.toBeNull();

    await user.keyboard('{Escape}');
    await waitFor(() => expect(document.activeElement).toBe(documentation));

    const changelog = screen.getByRole('button', { name: /aboutChangelog/ });
    await user.click(changelog);
    const changelogDialog = within(overlayRoot).getByRole('dialog', {
      name: 'aboutChangelog'
    });
    expect(within(changelogDialog).getByText('vaboutCurrentVersionValue')).not.toBeNull();
    expect(within(changelogDialog).getByText('vaboutVersion017')).not.toBeNull();
    await user.click(within(changelogDialog).getByRole('button', { name: 'aboutClose' }));
    await waitFor(() => expect(document.activeElement).toBe(changelog));
  });
});

describe('SettingsCenterRoot persistence', () => {
  it('saves edited settings through WordPress and reports completion', async () => {
    const user = userEvent.setup();
    const fetch = vi.spyOn(window, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ settings: bootstrap().settings })
    } as Response);
    render(<SettingsCenterRoot bootstrap={bootstrap()} />);

    await user.click(screen.getByRole('switch', { name: 'autoFocusEditor' }));
    const save = screen.getByRole<HTMLButtonElement>('button', { name: 'saveSettings' });
    expect(save.disabled).toBe(false);
    await user.click(save);

    await waitFor(() => expect(screen.getByText('settingsSaved')).not.toBeNull());
    expect(fetch).toHaveBeenCalledOnce();
    fetch.mockRestore();
  });
});
