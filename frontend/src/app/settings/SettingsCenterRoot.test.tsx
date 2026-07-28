import { createElement } from '@wordpress/element';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import {
  SETTINGS_CENTER_STRING_KEYS,
  type SettingsCenterBootstrap
} from '../../contracts/bootstrap/settings-center-bootstrap';
import { SettingsCenterRoot } from './SettingsCenterRoot';

function bootstrap(): SettingsCenterBootstrap {
  return {
    schemaVersion: 2,
    closeUrl: '/wp-admin/options-general.php?page=easymde',
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
      ai: {
        provider: 'OpenAI',
        endpoint: 'https://api.example.test/v1',
        apiKey: 'example-api-key',
        model: 'gpt-4.1-mini'
      }
    },
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

    await user.type(search, 'promptManagement');

    const result = await screen.findByRole('button', { name: 'promptManagement' });
    expect(screen.getByRole('button', { name: 'ai' }).getAttribute('aria-current'))
      .toBe('page');
    await user.click(result);

    expect(search.value).toBe('');
    expect(screen.getByRole('heading', { name: 'promptManagement' })).not.toBeNull();
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

    await user.type(screen.getByRole('searchbox', { name: 'searchSettings' }), 'promptManagement');
    await user.click(await screen.findByRole('button', { name: 'promptManagement' }));
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

  it('reproduces the session-only image-host connection states', async () => {
    const user = userEvent.setup();
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

    expect(primaryTest.disabled).toBe(false);
    expect(backupTest.disabled).toBe(false);
    expect(images.getAllByText('connected')).toHaveLength(2);
    expect(images.getByText('lastTest')).not.toBeNull();

    await user.click(primaryTest);
    expect(primaryTest.disabled).toBe(true);
    expect(images.getByText('testing')).not.toBeNull();
    await waitFor(() => expect(images.getAllByText('connected')).toHaveLength(2), {
      timeout: 1_000
    });
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
});

describe('SettingsCenterRoot AI section', () => {
  it('renders the complete AI groups after Images in the continuous settings card', () => {
    const { container } = render(<SettingsCenterRoot bootstrap={bootstrap()} />);
    const sections = Array.from(container.querySelectorAll('[data-settings-section]'));

    expect(sections.slice(0, 4).map((section) => section.getAttribute('data-settings-section')))
      .toEqual(['general', 'shortcuts', 'images', 'ai']);
    expect(screen.getByRole('heading', { name: 'aiServiceConfiguration' })).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'aiAutocomplete' })).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'writingAssistance' })).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'generationPreferences' })).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'promptManagement' })).not.toBeNull();
  });

  it('keeps AI service and autocomplete controls in browser-session state', async () => {
    const user = userEvent.setup();
    render(<SettingsCenterRoot bootstrap={bootstrap()} />);
    const apiKey = screen.getByLabelText<HTMLInputElement>('aiApiKey');
    const autoComplete = screen.getByRole('switch', { name: 'enableAiAutocomplete' });
    const trigger = screen.getByRole<HTMLSelectElement>('combobox', { name: 'completionTrigger' });

    expect(apiKey.type).toBe('password');
    await user.click(screen.getByRole('button', { name: 'showAiApiKey' }));
    expect(apiKey.type).toBe('text');
    expect(autoComplete.getAttribute('aria-checked')).toBe('true');
    await user.click(autoComplete);
    await user.selectOptions(trigger, 'completionTriggerShortcut');
    await user.click(screen.getByRole('button', { name: 'restoreAutocompleteDefaults' }));
    expect(autoComplete.getAttribute('aria-checked')).toBe('true');
    expect(trigger.value).toBe('completionTriggerTab');
  });

  it('renders connection feedback outside the scaled settings sections', async () => {
    const user = userEvent.setup();
    const { container } = render(<SettingsCenterRoot bootstrap={bootstrap()} />);
    const aiSection = container.querySelector('[data-settings-section="ai"]');
    const overlayRoot = container.querySelector('[data-settings-overlay-root]');
    if (!(aiSection instanceof HTMLElement) || !(overlayRoot instanceof HTMLElement)) {
      throw new Error('settings-center-overlay-structure-missing');
    }

    await user.click(within(aiSection).getByRole('button', { name: 'testConnection' }));
    const feedback = within(overlayRoot).getByRole('status');

    expect(aiSection.contains(feedback)).toBe(false);
    expect(feedback.textContent).toContain('aiConnectionTesting');
    await waitFor(() => expect(feedback.textContent).toContain('aiConnectionSuccess'), {
      timeout: 1_000
    });
  });

  it('duplicates, deletes, and validates prompts without persisting them', async () => {
    const user = userEvent.setup();
    render(<SettingsCenterRoot bootstrap={bootstrap()} />);

    expect(screen.getAllByText('defaultPromptTitleName')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'duplicatePrompt defaultPromptTitleName' }));
    expect(screen.getByText('defaultPromptTitleName promptCopySuffix')).not.toBeNull();
    await user.click(screen.getByRole('button', {
      name: 'deletePrompt defaultPromptTitleName promptCopySuffix'
    }));
    expect(screen.getByRole('dialog', { name: 'deletePromptTitle' })).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'confirmDelete' }));
    expect(screen.queryByText('defaultPromptTitleName promptCopySuffix')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'createPrompt' }));
    expect(screen.getByRole('dialog', { name: 'createPromptTitle' })).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'savePrompt' }));
    expect(screen.getByRole('alert').textContent).toContain('promptNameAndContentRequired');
  });
});

describe('SettingsCenterRoot Markdown section', () => {
  it('renders every Markdown group after AI in the continuous settings card', () => {
    const { container } = render(<SettingsCenterRoot bootstrap={bootstrap()} />);
    const sections = Array.from(container.querySelectorAll('[data-settings-section]'));

    expect(sections.slice(0, 5).map((section) => section.getAttribute('data-settings-section')))
      .toEqual(['general', 'shortcuts', 'images', 'ai', 'markdown']);
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

describe('SettingsCenterRoot Sync section', () => {
  it('renders the complete Sync groups after Markdown instead of a placeholder', () => {
    const { container } = render(<SettingsCenterRoot bootstrap={bootstrap()} />);
    const sections = Array.from(container.querySelectorAll('[data-settings-section]'));

    expect(sections.slice(0, 6).map((section) => section.getAttribute('data-settings-section')))
      .toEqual(['general', 'shortcuts', 'images', 'ai', 'markdown', 'sync']);
    expect(screen.getByRole('heading', { name: /syncBrowserExtensionConnection/ })).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'syncPlatformStatus' })).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'syncNotification' })).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'syncGroupBotNotifications' })).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'syncHistory' })).not.toBeNull();
    expect(screen.getByText('syncTemplatePreviewTitle')).not.toBeNull();
    expect(screen.getByText('syncTemplatePreviewBody')).not.toBeNull();
  });

  it('keeps Sync notification controls and feedback in browser-session state', async () => {
    const user = userEvent.setup();
    const { container } = render(<SettingsCenterRoot bootstrap={bootstrap()} />);
    const syncSection = container.querySelector('[data-settings-section="sync"]');
    const overlayRoot = container.querySelector('[data-settings-overlay-root]');
    if (!(syncSection instanceof HTMLElement) || !(overlayRoot instanceof HTMLElement)) {
      throw new Error('settings-center-sync-structure-missing');
    }
    const sync = within(syncSection);
    const browserNotifications = sync.getByRole('switch', { name: 'syncBrowserNotification' });

    expect(browserNotifications.getAttribute('aria-checked')).toBe('true');
    await user.click(browserNotifications);
    expect(browserNotifications.getAttribute('aria-checked')).toBe('false');

    await user.click(sync.getByRole('button', { name: 'syncCheckConnection' }));
    const feedback = within(overlayRoot).getByRole('status');
    expect(syncSection.contains(feedback)).toBe(false);
    expect(feedback.textContent).toContain('syncStatusesChecked');
  });

  it('preserves translated history-summary placeholder segments', () => {
    const data = bootstrap();
    render(<SettingsCenterRoot bootstrap={{
      ...data,
      strings: {
        ...data.strings,
        syncHistorySummary: '共 %1$s 条，第 %2$s / %3$s 页'
      }
    }} />);

    const summary = screen.getByText('共 25 条，第 1 / 3 页');
    expect(Array.from(summary.childNodes, (node) => node.textContent)).toEqual([
      '共 ',
      '25',
      ' 条，第 ',
      '1',
      ' / ',
      '3',
      ' 页'
    ]);
  });

  it('opens the extension connection dialog and restores trigger focus', async () => {
    const user = userEvent.setup();
    const { container } = render(<SettingsCenterRoot bootstrap={bootstrap()} />);
    const overlayRoot = container.querySelector('[data-settings-overlay-root]');
    if (!(overlayRoot instanceof HTMLElement)) throw new Error('settings-center-overlay-missing');
    const trigger = screen.getByRole('button', { name: 'syncOpenExtensionSettings' });

    await user.click(trigger);
    const dialog = within(overlayRoot).getByRole('dialog', {
      name: 'syncExtensionDialogTitle'
    });
    expect(within(dialog).getByText('syncAuthorizedPlatforms')).not.toBeNull();
    expect(within(dialog).getAllByText('syncLoggedIn')).toHaveLength(3);

    await user.keyboard('{Escape}');
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('opens platform management, updates authorization, and restores trigger focus', async () => {
    const user = userEvent.setup();
    const { container } = render(<SettingsCenterRoot bootstrap={bootstrap()} />);
    const overlayRoot = container.querySelector('[data-settings-overlay-root]');
    if (!(overlayRoot instanceof HTMLElement)) throw new Error('settings-center-overlay-missing');
    const trigger = screen.getByRole('button', { name: 'syncMoreActions 知乎' });

    await user.click(trigger);
    const dialog = within(overlayRoot).getByRole('dialog', {
      name: 'syncPlatformDialogTitle 知乎'
    });
    expect(within(dialog).getByText('syncCheckCurrentAuthorization')).not.toBeNull();
    expect(within(dialog).getByText('syncViewPlatformHistory')).not.toBeNull();
    expect(within(dialog).getByText('syncRevokeAuthorization')).not.toBeNull();

    await user.click(within(dialog).getByRole('button', { name: 'syncRevokeAuthorization' }));
    expect(within(overlayRoot).getByRole('status').textContent)
      .toContain('syncPlatformRevoked 知乎');
    await waitFor(() => expect(document.activeElement).toBe(trigger));

    await user.click(trigger);
    expect(within(overlayRoot).getByRole('dialog', {
      name: 'syncPlatformDialogTitle 知乎'
    })).not.toBeNull();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('opens history details, reports unavailable article links, and restores focus', async () => {
    const user = userEvent.setup();
    const { container } = render(<SettingsCenterRoot bootstrap={bootstrap()} />);
    const overlayRoot = container.querySelector('[data-settings-overlay-root]');
    if (!(overlayRoot instanceof HTMLElement)) throw new Error('settings-center-overlay-missing');
    const trigger = screen.getAllByRole('button', { name: 'syncViewDetails' })[0];
    if (!trigger) throw new Error('settings-center-sync-history-trigger-missing');

    await user.click(trigger);
    const dialog = within(overlayRoot).getByRole('dialog', {
      name: 'syncHistoryDetailTitle'
    });
    expect(within(dialog).getByRole('region', { name: 'syncResultSummary' })).not.toBeNull();
    expect(within(dialog).getByText('syncTargetPlatformCount 5')).not.toBeNull();
    const articleLinks = within(dialog).getAllByRole('button', { name: 'syncViewArticle' });
    expect(articleLinks).toHaveLength(5);
    const firstArticleLink = articleLinks[0];
    if (!firstArticleLink) throw new Error('settings-center-sync-article-link-missing');

    await user.click(firstArticleLink);
    expect(within(overlayRoot).getByRole('status').textContent)
      .toContain('syncArticleLinkPending');

    await user.keyboard('{Escape}');
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});

describe('SettingsCenterRoot Transfer section', () => {
  it('renders the complete Transfer groups after Sync instead of a placeholder', () => {
    const { container } = render(<SettingsCenterRoot bootstrap={bootstrap()} />);
    const sections = Array.from(container.querySelectorAll('[data-settings-section]'));

    expect(sections.slice(0, 7).map((section) => section.getAttribute('data-settings-section')))
      .toEqual(['general', 'shortcuts', 'images', 'ai', 'markdown', 'sync', 'transfer']);
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

  it('opens the reset dialog and reports the unconnected mutation truthfully', async () => {
    const user = userEvent.setup();
    const { container } = render(<SettingsCenterRoot bootstrap={bootstrap()} />);
    const overlayRoot = container.querySelector('[data-settings-overlay-root]');
    if (!(overlayRoot instanceof HTMLElement)) throw new Error('settings-center-overlay-missing');

    await user.click(screen.getByRole('button', { name: /transferResetCurrentConfiguration/ }));
    const dialog = within(overlayRoot).getByRole('dialog', {
      name: 'transferResetCurrentConfiguration'
    });
    expect(within(dialog).getByText('transferResetWarning')).not.toBeNull();

    await user.click(within(dialog).getByRole('button', { name: 'transferConfirmReset' }));
    const feedback = within(overlayRoot).getByRole('status');
    expect(feedback.textContent).toContain('transferIntegrationPendingNotice');
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
    expect(within(statusDialog).getByText('transferCheckPersistencePending')).not.toBeNull();
  });
});

describe('SettingsCenterRoot About section', () => {
  it('renders every About group after Transfer instead of a placeholder', () => {
    const { container } = render(<SettingsCenterRoot bootstrap={bootstrap()} />);
    const sections = Array.from(container.querySelectorAll('[data-settings-section]'));

    expect(sections.map((section) => section.getAttribute('data-settings-section')))
      .toEqual(['general', 'shortcuts', 'images', 'ai', 'markdown', 'sync', 'transfer', 'about']);
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
