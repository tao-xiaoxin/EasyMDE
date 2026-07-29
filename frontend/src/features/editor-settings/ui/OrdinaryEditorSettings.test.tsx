import { createElement } from '@wordpress/element';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AppearanceBootstrap } from '../../../contracts/bootstrap/appearance-bootstrap';
import type { FontControlsBootstrap } from '../../../contracts/bootstrap/font-controls-bootstrap';
import {
  customCssDialogStrings,
  customCssVariables
} from '../../../test/fixtures/appearance-bootstrap';
import { OrdinaryEditorSettings } from './OrdinaryEditorSettings';

const originalInnerHeight = Object.getOwnPropertyDescriptor(window, 'innerHeight');
const originalInnerWidth = Object.getOwnPropertyDescriptor(window, 'innerWidth');

const appearance: AppearanceBootstrap = {
  articleThemes: [
    { id: 'default', label: 'Default', defaultCodeTheme: 'atom-one-dark' },
    { id: 'newsprint', label: 'Newsprint', defaultCodeTheme: 'atom-one-dark' }
  ],
  canManageCustomCss: true,
  codeThemeExplicit: false,
  codeThemes: [
    { id: 'atom-one-dark', label: 'Atom One Dark' },
    { id: 'github', label: 'GitHub' }
  ],
  customCss: [{
    articleThemeName: 'Writer Article',
    codeThemeName: 'Writer Code',
    id: 'writer-css',
    css: '.note { color: navy; }',
    scopedCss: '.easymde-rendered-content .note { color: navy; }'
  }],
  customCssVariables,
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
    customCssDialog: customCssDialogStrings,
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
        previewCustomCss: vi.fn(),
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

afterEach(() => {
  vi.restoreAllMocks();
  if (originalInnerWidth) {
    Object.defineProperty(window, 'innerWidth', originalInnerWidth);
  }
  if (originalInnerHeight) {
    Object.defineProperty(window, 'innerHeight', originalInnerHeight);
  }
});

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

  it('stays open after a pointer selects an option that unmounts its listbox', async () => {
    const user = userEvent.setup();
    renderSettings();
    const settingsTrigger = screen.getByRole('button', {
      name: 'Editor settings'
    });

    await user.click(settingsTrigger);
    await user.click(screen.getByRole('combobox', { name: 'Article theme' }));
    await user.click(screen.getByRole('option', { name: 'Newsprint' }));

    expect(settingsTrigger.getAttribute('aria-expanded')).toBe('true');
    expect(
      screen.getByRole('dialog', { name: 'Editor settings' })
    ).not.toBeNull();
    expect(
      screen.getByRole('combobox', { name: 'Article theme' }).textContent
    ).toContain('Newsprint');
  });

  it('keeps the anchored panel inside the visible viewport', async () => {
    const user = userEvent.setup();
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: 1280
    });
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: 720
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function getBoundingClientRect(this: HTMLElement) {
        if (this.classList.contains('easymde-toolbar-settings-trigger')) {
          return DOMRect.fromRect({
            x: 911,
            y: 200,
            width: 38,
            height: 36
          });
        }
        return DOMRect.fromRect();
      });
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get')
      .mockImplementation(function scrollHeight(this: HTMLElement) {
        return this.classList.contains('easymde-toolbar-popover-settings-panel')
          ? 388
          : 0;
      });
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get')
      .mockImplementation(function clientHeight(this: HTMLElement) {
        return this.classList.contains('easymde-toolbar-popover-settings-panel')
          ? 388
          : 0;
      });
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get')
      .mockImplementation(function offsetHeight(this: HTMLElement) {
        return this.classList.contains('easymde-toolbar-popover-settings-panel')
          ? 390
          : 0;
      });

    renderSettings();
    await user.click(screen.getByRole('button', { name: 'Editor settings' }));
    const panel = screen.getByRole('dialog', { name: 'Editor settings' });
    const top = Number.parseFloat(panel.style.top);
    const maxHeight = Number.parseFloat(panel.style.maxHeight);

    expect(panel.style.position).toBe('fixed');
    expect(panel.style.width).toBe('468px');
    expect(maxHeight).toBe(390);
    expect(top).toBeGreaterThanOrEqual(12);
    expect(top + maxHeight).toBeLessThanOrEqual(708);
    expect(
      document.querySelector('.easymde-editor-settings-tail.is-below')
    ).not.toBeNull();
  });

  it('moves the panel and its tail above a trigger near the viewport bottom', async () => {
    const user = userEvent.setup();
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: 1280
    });
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: 720
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function getBoundingClientRect(this: HTMLElement) {
        if (this.classList.contains('easymde-toolbar-settings-trigger')) {
          return DOMRect.fromRect({
            x: 911,
            y: 650,
            width: 38,
            height: 36
          });
        }
        return DOMRect.fromRect();
      });
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get')
      .mockImplementation(function scrollHeight(this: HTMLElement) {
        return this.classList.contains('easymde-toolbar-popover-settings-panel')
          ? 388
          : 0;
      });

    renderSettings();
    await user.click(screen.getByRole('button', { name: 'Editor settings' }));
    const panel = screen.getByRole('dialog', { name: 'Editor settings' });
    const top = Number.parseFloat(panel.style.top);
    const maxHeight = Number.parseFloat(panel.style.maxHeight);
    const tail = document.querySelector<HTMLElement>(
      '.easymde-editor-settings-tail.is-above'
    );

    expect(top).toBeGreaterThanOrEqual(12);
    expect(top + maxHeight).toBeLessThan(650);
    expect(tail).not.toBeNull();
    expect(Number.parseFloat(tail?.style.top ?? '')).toBe(top + maxHeight - 7);
  });

  it('closes the fixed panel when scrolling moves its trigger outside the viewport', async () => {
    const user = userEvent.setup();
    let triggerTop = 200;
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: 1280
    });
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: 720
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function getBoundingClientRect(this: HTMLElement) {
        if (this.classList.contains('easymde-toolbar-settings-trigger')) {
          return DOMRect.fromRect({
            x: 911,
            y: triggerTop,
            width: 38,
            height: 36
          });
        }
        return DOMRect.fromRect();
      });
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get')
      .mockImplementation(function scrollHeight(this: HTMLElement) {
        return this.classList.contains('easymde-toolbar-popover-settings-panel')
          ? 388
          : 0;
      });

    renderSettings();
    const trigger = screen.getByRole('button', { name: 'Editor settings' });
    await user.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    triggerTop = -100;
    fireEvent.scroll(document);

    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(
      screen.queryByRole('dialog', { name: 'Editor settings' })
    ).toBeNull();
    expect(
      document.querySelector('.easymde-editor-settings-tail')
    ).toBeNull();
  });
});
