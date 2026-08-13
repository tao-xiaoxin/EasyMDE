import { createElement } from '@wordpress/element';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppearanceBootstrap } from '../../../contracts/bootstrap/appearance-bootstrap';
import type { FontControlsBootstrap } from '../../../contracts/bootstrap/font-controls-bootstrap';
import {
  customCssDialogStrings,
  customCssVariables
} from '../../../test/fixtures/appearance-bootstrap';
import { OrdinaryEditorSettings } from './OrdinaryEditorSettings';

const originalInnerHeight = Object.getOwnPropertyDescriptor(window, 'innerHeight');
const originalInnerWidth = Object.getOwnPropertyDescriptor(window, 'innerWidth');
type ObserverRecord = Readonly<{
  callback: IntersectionObserverCallback;
  disconnect: ReturnType<typeof vi.fn>;
  observe: ReturnType<typeof vi.fn>;
  observer: IntersectionObserver;
}>;
let observerRecords: ObserverRecord[] = [];

function intersectionEntry(
  target: Element,
  isIntersecting: boolean
): IntersectionObserverEntry {
  const rectangle = DOMRect.fromRect();
  return {
    boundingClientRect: rectangle,
    intersectionRatio: isIntersecting ? 1 : 0,
    intersectionRect: rectangle,
    isIntersecting,
    rootBounds: null,
    target,
    time: 0
  };
}

function emitIntersection(
  record: ObserverRecord | undefined,
  target: Element,
  isIntersecting: boolean
): void {
  if (!record) throw new Error('intersection-observer-test-owner-unavailable');
  record.callback(
    [intersectionEntry(target, isIntersecting)],
    record.observer
  );
}

const appearance: AppearanceBootstrap = {
  articleThemes: [
    {
      id: 'default',
      label: 'Default',
      defaultCodeTheme: 'atom-one-dark',
      markupProfile: 'common-v1'
    },
    {
      id: 'newsprint',
      label: 'Newsprint',
      defaultCodeTheme: 'atom-one-dark',
      markupProfile: 'common-v1'
    }
  ],
  canManageCustomCss: true,
  codeThemeExplicit: false,
  customMarkupProfile: 'common-v1',
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
    themeApplyFailed: 'Theme could not be applied. The saved theme is still available.',
    cssNameDuplicate: 'A theme with this name already exists.',
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
        applyState: vi.fn().mockResolvedValue(true),
        cancelPendingApply: vi.fn(),
        closeOtherPopovers: vi.fn(),
        dispose: vi.fn(),
        previewCustomCss: vi.fn(),
        saveCustomCss: vi.fn()
      }}
      fonts={fonts}
      fontControlsPort={{
        applyState: vi.fn(),
        closeOtherPopovers: vi.fn()
      }}
      label="Editor settings"
      messageAlertTimer={{
        now: () => Date.now(),
        schedule: (callback, delay) => {
          const timer = window.setTimeout(callback, delay);
          return () => window.clearTimeout(timer);
        }
      }}
      onAppearanceReady={vi.fn()}
      onFailure={vi.fn()}
      onFontControlsReady={vi.fn()}
      onOpen={vi.fn()}
      onReady={vi.fn()}
    />
  );
}

beforeEach(() => {
  observerRecords = [];
  vi.stubGlobal(
    'IntersectionObserver',
    class IntersectionObserverMock {
      public readonly root = null;
      public readonly rootMargin = '0px';
      public readonly scrollMargin = '0px';
      public readonly thresholds = [0];
      public readonly disconnect = vi.fn();
      public readonly observe = vi.fn();
      public readonly unobserve = vi.fn();

      public constructor(callback: IntersectionObserverCallback) {
        observerRecords.push({
          callback,
          disconnect: this.disconnect,
          observe: this.observe,
          observer: this
        });
      }

      public takeRecords(): IntersectionObserverEntry[] {
        return [];
      }
    }
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
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

  it('closes the fixed panel when its trigger leaves the viewport', async () => {
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

    renderSettings();
    const trigger = screen.getByRole('button', { name: 'Editor settings' });
    await user.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const focusTrigger = vi.spyOn(trigger, 'focus');
    const observer = observerRecords.at(-1);
    expect(observer).toBeDefined();
    expect(observer?.observe).toHaveBeenCalledWith(trigger);

    act(() => {
      emitIntersection(observer, trigger, false);
    });

    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger);
    expect(focusTrigger).toHaveBeenCalledWith({ preventScroll: true });
    expect(
      screen.queryByRole('dialog', { name: 'Editor settings' })
    ).toBeNull();
    expect(
      document.querySelector('.easymde-editor-settings-tail')
    ).toBeNull();
    expect(observer?.disconnect).toHaveBeenCalledTimes(1);
  });

  it('ignores stale visibility callbacks after reopening the panel', async () => {
    const user = userEvent.setup();
    renderSettings();
    const trigger = screen.getByRole('button', { name: 'Editor settings' });

    await user.click(trigger);
    const firstObserver = observerRecords.at(-1);
    act(() => {
      emitIntersection(firstObserver, trigger, true);
    });
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    await user.keyboard('{Escape}');
    await user.click(trigger);
    const secondObserver = observerRecords.at(-1);
    expect(secondObserver).not.toBe(firstObserver);
    expect(firstObserver?.disconnect).toHaveBeenCalledTimes(1);

    act(() => {
      emitIntersection(firstObserver, trigger, false);
    });
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    act(() => {
      emitIntersection(secondObserver, trigger, false);
    });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('ignores captured scroll events from the panel and its descendants', async () => {
    const user = userEvent.setup();
    renderSettings();
    const trigger = screen.getByRole('button', { name: 'Editor settings' });

    await user.click(trigger);
    const panel = screen.getByRole('dialog', { name: 'Editor settings' });
    const descendant = screen.getByRole('combobox', { name: 'Article theme' });
    const readTriggerRect = vi.spyOn(trigger, 'getBoundingClientRect');
    fireEvent.scroll(panel);
    fireEvent.scroll(descendant);

    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(panel.hidden).toBe(false);
    expect(readTriggerRect).not.toHaveBeenCalled();
  });
});
