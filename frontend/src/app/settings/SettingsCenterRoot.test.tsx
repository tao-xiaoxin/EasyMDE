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
    settings: {
      optionKey: 'easymde_editor_settings',
      toolbarLayout: 'hybrid-icons',
      shortcuts: {
        savepost: { win: 'Ctrl+S', mac: 'Cmd+S' },
        bold: { win: 'Ctrl+B', mac: 'Cmd+B' }
      }
    },
    commands: [
      {
        id: 'savepost', label: 'Save post', group: 'system',
        defaultShortcutWin: 'Ctrl+S', defaultShortcutMac: 'Cmd+S'
      },
      {
        id: 'bold', label: 'Bold', group: 'format',
        defaultShortcutWin: 'Ctrl+B', defaultShortcutMac: 'Cmd+B'
      },
      {
        id: 'ai', label: 'AI Assistant', group: 'system',
        defaultShortcutWin: 'Ctrl+Alt+A', defaultShortcutMac: 'Cmd+Option+A'
      }
    ],
    assets: {
      brandMarkUrl: '/plugin/brand.png',
      headerIllustrationUrl: '/plugin/header.png',
      searchEmptyIllustrationUrl: '/plugin/search-empty.png'
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
      transferChecksSummary: 'transferChecksSummary %s',
      transferChecksPassed: 'transferChecksPassed %s'
    } as SettingsCenterBootstrap['strings']
  };
}

describe('SettingsCenterRoot', () => {
  it('keeps AI and article-sync settings out of the rendered navigation and sections', () => {
    const { container } = render(<SettingsCenterRoot bootstrap={bootstrap()} />);
    const sections = Array.from(container.querySelectorAll('[data-settings-section]'));

    expect(sections.map((section) => section.getAttribute('data-settings-section'))).toEqual([
      'general', 'shortcuts', 'images', 'markdown', 'transfer', 'about'
    ]);
    expect(screen.queryByRole('button', { name: 'ai' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'sync' })).toBeNull();
    expect(container.querySelector('[data-settings-section="ai"]')).toBeNull();
    expect(container.querySelector('[data-settings-section="sync"]')).toBeNull();
    expect(screen.queryByLabelText('aiApiKey')).toBeNull();
  });

  it('indexes real settings and opens a matching result', async () => {
    const user = userEvent.setup();
    render(<SettingsCenterRoot bootstrap={bootstrap()} />);
    const search = screen.getByRole<HTMLInputElement>('searchbox', { name: 'searchSettings' });

    await user.type(search, 'toolbarLayout');

    const result = await screen.findByRole('button', { name: /toolbarLayout/ });
    await user.click(result);

    expect(search.value).toBe('');
    expect(screen.getByRole('button', { name: 'general' }).getAttribute('aria-current'))
      .toBe('page');
  });

  it('reports no results after searching the complete rendered index', async () => {
    const user = userEvent.setup();
    render(<SettingsCenterRoot bootstrap={bootstrap()} />);

    await user.type(screen.getByRole('searchbox', { name: 'searchSettings' }), 'not-a-setting');

    expect(await screen.findByRole('heading', { name: 'noSearchResults' })).not.toBeNull();
  });

  it('cancels pending result navigation when the root unmounts', async () => {
    const user = userEvent.setup();
    const requestAnimationFrame = vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(41);
    const cancelAnimationFrame = vi.spyOn(window, 'cancelAnimationFrame')
      .mockImplementation(() => undefined);
    const { unmount } = render(<SettingsCenterRoot bootstrap={bootstrap()} />);

    await user.type(screen.getByRole('searchbox', { name: 'searchSettings' }), 'toolbarLayout');
    await user.click(await screen.findByRole('button', { name: /toolbarLayout/ }));

    unmount();
    expect(cancelAnimationFrame).toHaveBeenCalledWith(41);
    requestAnimationFrame.mockRestore();
    cancelAnimationFrame.mockRestore();
  });
});

describe('SettingsCenterRoot real WordPress settings controls', () => {
  it('renders current shortcuts as native option inputs and excludes the AI command', () => {
    const { container } = render(<SettingsCenterRoot bootstrap={bootstrap()} />);

    expect(screen.getByRole('textbox', { name: 'Save post windowsLinux' })).not.toBeNull();
    expect(screen.queryByRole('textbox', { name: 'AI Assistant windowsLinux' })).toBeNull();
    expect(container.querySelector(
      'input[name="easymde_editor_settings[shortcuts][savepost][win]"]'
    )).not.toBeNull();
    expect(container.querySelector(
      'input[name="easymde_editor_settings[toolbar_layout]"]'
    )).not.toBeNull();
  });

  it('edits a shortcut and restores the PHP-provided default before explicit save', async () => {
    const user = userEvent.setup();
    render(<SettingsCenterRoot bootstrap={bootstrap()} />);
    const windowsSave = screen.getByRole<HTMLInputElement>('textbox', {
      name: 'Save post windowsLinux'
    });

    await user.clear(windowsSave);
    await user.type(windowsSave, 'Ctrl+Shift+S');
    expect(windowsSave.value).toBe('Ctrl+Shift+S');

    await user.click(screen.getByRole('button', { name: 'restoreDefaultShortcuts' }));
    expect(windowsSave.value).toBe('Ctrl+S');
  });

  it('shows pending sections without presenting fake controls', () => {
    const { container } = render(<SettingsCenterRoot bootstrap={bootstrap()} />);
    const pendingSections = container.querySelectorAll('.easymde-settings-center__pending');

    expect(pendingSections).toHaveLength(3);
    expect(screen.queryByRole('button', { name: 'testConnection' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'transferConfirmImport' })).toBeNull();
  });
});

describe('SettingsCenterRoot About section', () => {
  it('keeps About actions truthful and restores dialog focus', async () => {
    const user = userEvent.setup();
    const { container } = render(<SettingsCenterRoot bootstrap={bootstrap()} />);
    const overlayRoot = container.querySelector('[data-settings-overlay-root]');
    if (!(overlayRoot instanceof HTMLElement)) throw new Error('settings-center-overlay-missing');

    await user.click(screen.getByRole('button', { name: 'aboutCheckUpdates' }));
    expect(within(overlayRoot).getByRole('status').textContent)
      .toContain('aboutActionPendingNotice');

    const documentation = screen.getByRole('button', { name: /aboutOfficialDocumentation/ });
    await user.click(documentation);
    const helpDialog = within(overlayRoot).getByRole('dialog', {
      name: 'aboutHelpDialogTitle'
    });
    expect(within(helpDialog).getByText('aboutHelpEditorWorkflowDescription')).not.toBeNull();

    await user.keyboard('{Escape}');
    await waitFor(() => expect(document.activeElement).toBe(documentation));
  });
});
