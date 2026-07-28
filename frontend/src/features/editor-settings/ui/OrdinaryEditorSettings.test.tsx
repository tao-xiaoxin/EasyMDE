import { createElement } from '@wordpress/element';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { AppearanceBootstrap } from '../../../contracts/bootstrap/appearance-bootstrap';
import type { FontControlsBootstrap } from '../../../contracts/bootstrap/font-controls-bootstrap';
import { OrdinaryEditorSettings } from './OrdinaryEditorSettings';

const appearance: AppearanceBootstrap = {
  articleThemes: [
    { id: 'default', label: 'Default', defaultCodeTheme: 'atom-one-dark' },
    { id: 'newsprint', label: 'Newsprint', defaultCodeTheme: 'atom-one-dark' }
  ],
  codeThemeExplicit: false,
  codeThemes: [
    { id: 'atom-one-dark', label: 'Atom One Dark' },
    { id: 'github', label: 'GitHub' }
  ],
  customCss: [{
    id: 'writer-css',
    name: 'Writer CSS',
    css: '.note { color: navy; }',
    scopedCss: '.easymde-rendered-content .note { color: navy; }'
  }],
  state: {
    markdownTheme: 'default',
    codeTheme: 'atom-one-dark',
    customCssId: ''
  },
  strings: {
    appearance: 'Appearance',
    articleTheme: 'Article theme',
    codeTheme: 'Code theme',
    customCss: 'Custom CSS',
    customCssTheme: 'Custom CSS theme',
    cssName: 'CSS name',
    saveCss: 'Save CSS',
    cssSaved: 'CSS saved.',
    cssSaveFailed: 'CSS save failed.',
    namedCustomCss: 'Named custom CSS'
  }
};

const fonts: FontControlsBootstrap = {
  options: {
    customFonts: [
      { id: 'none', label: 'No custom font', fontFamily: '' },
      { id: 'optima', label: 'Optima', fontFamily: '"Optima"' }
    ],
    windowsFonts: [
      { id: 'system', label: 'System', fontFamily: '' }
    ],
    appleFonts: [
      { id: 'system', label: 'System', fontFamily: '' }
    ],
    serifOptions: [
      { id: 'off', label: 'Off', fontFamily: '' }
    ]
  },
  state: {
    customFont: 'none',
    windowsFont: 'system',
    appleFont: 'system',
    serifFont: 'off'
  },
  strings: {
    font: 'Font',
    customFont: 'Custom font',
    windowsFont: 'Windows font',
    appleFont: 'Apple font',
    serifFont: 'Serif font',
    fontStackHelp: 'Fonts are applied in fallback order.'
  }
};

function renderSettings() {
  return render(
    <OrdinaryEditorSettings
      appearance={appearance}
      appearancePort={{
        applyState: vi.fn(),
        closeOtherPopovers: vi.fn(),
        saveCustomCss: vi.fn()
      }}
      fonts={fonts}
      fontControlsPort={{
        applyState: vi.fn(),
        closeOtherPopovers: vi.fn()
      }}
      label="Editor settings"
      onAppearanceReady={vi.fn()}
      onFailure={vi.fn()}
      onFontControlsReady={vi.fn()}
      onOpen={vi.fn()}
      onReady={vi.fn()}
    />
  );
}

describe('OrdinaryEditorSettings', () => {
  it('replaces separate Font and Appearance buttons with one compact settings entry', async () => {
    const user = userEvent.setup();
    renderSettings();

    const trigger = screen.getByRole('button', { name: 'Editor settings' });
    expect(trigger.querySelector('svg')).not.toBeNull();
    expect(trigger.querySelector('.easymde-toolbar-chevron')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Font' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Appearance' })).toBeNull();

    await user.click(trigger);

    expect(screen.getByRole('dialog', { name: 'Editor settings' })).not.toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole('combobox', { name: 'Article theme' })
    );
    expect(screen.getAllByRole('combobox')).toHaveLength(6);
    expect(screen.getByRole('combobox', { name: 'Article theme' })).not.toBeNull();
    expect(screen.getByRole('combobox', { name: 'Code theme' })).not.toBeNull();
    expect(screen.getByRole('combobox', { name: 'Custom font' })).not.toBeNull();
    expect(screen.getByRole('combobox', { name: 'Windows font' })).not.toBeNull();
    expect(screen.getByRole('combobox', { name: 'Apple font' })).not.toBeNull();
    expect(screen.getByRole('combobox', { name: 'Serif font' })).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Custom CSS' })).toBeNull();
  });

  it('contains keyboard focus while the settings dialog is open', async () => {
    const user = userEvent.setup();
    renderSettings();

    await user.click(screen.getByRole('button', { name: 'Editor settings' }));
    const firstControl = screen.getByRole('combobox', { name: 'Article theme' });
    const lastControl = screen.getByRole('combobox', { name: 'Serif font' });

    await user.tab({ shift: true });
    expect(document.activeElement).toBe(lastControl);

    await user.tab();
    expect(document.activeElement).toBe(firstControl);
  });

  it('closes on Escape and restores focus to the settings trigger', async () => {
    const user = userEvent.setup();
    renderSettings();
    const trigger = screen.getByRole('button', { name: 'Editor settings' });

    await user.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    await user.keyboard('{Escape}');

    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger);
  });

  it('does not intercept Escape consumed by a nested control', async () => {
    const user = userEvent.setup();
    renderSettings();
    const trigger = screen.getByRole('button', { name: 'Editor settings' });

    await user.click(trigger);
    const select = screen.getByRole('combobox', { name: 'Article theme' });
    select.addEventListener('keydown', (event) => {
      if ('Escape' === event.key) event.stopPropagation();
    });

    fireEvent.keyDown(select, { key: 'Escape' });

    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(select);
  });
});
