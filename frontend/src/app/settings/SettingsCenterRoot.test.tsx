import { createElement } from '@wordpress/element';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import {
  SETTINGS_CENTER_STRING_KEYS,
  type SettingsCenterBootstrap
} from '../../contracts/bootstrap/settings-center-bootstrap';
import { SettingsCenterRoot } from './SettingsCenterRoot';

function bootstrap(): SettingsCenterBootstrap {
  return {
    schemaVersion: 1,
    closeUrl: '/wp-admin/options-general.php?page=easymde',
    assets: {
      brandMarkUrl: '/plugin/brand.png',
      headerIllustrationUrl: '/plugin/header.png',
      searchEmptyIllustrationUrl: '/plugin/search-empty.png'
    },
    strings: Object.fromEntries(
      SETTINGS_CENTER_STRING_KEYS.map((key) => [key, key])
    ) as SettingsCenterBootstrap['strings']
  };
}

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

  it('does not claim image-host connectivity without a real validation owner', () => {
    render(<SettingsCenterRoot bootstrap={bootstrap()} />);

    const primaryTest = screen.getByRole<HTMLButtonElement>('button', {
      name: 'testConnection'
    });
    const backupTest = screen.getByRole<HTMLButtonElement>('button', {
      name: 'testBackupConnection'
    });

    expect(primaryTest.disabled).toBe(true);
    expect(backupTest.disabled).toBe(true);
    expect(screen.getAllByText('pendingTest')).toHaveLength(2);
    expect(screen.queryByText('connected')).toBeNull();
    expect(screen.queryByText('lastTest')).toBeNull();
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
