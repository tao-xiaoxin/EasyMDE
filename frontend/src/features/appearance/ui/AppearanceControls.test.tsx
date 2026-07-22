import { createElement } from '@wordpress/element';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { AppearanceBootstrap } from '../../../contracts/bootstrap/appearance-bootstrap';
import type { AppearancePort } from '../../../contracts/ports/appearance-port';
import {
  AppearanceControls,
  type AppearanceControlsSession
} from './AppearanceControls';

const bootstrap: AppearanceBootstrap = {
  articleThemes: [
    { id: 'default', label: 'Default' },
    { id: 'newsprint', label: 'Newsprint' }
  ],
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
    cssName: 'CSS name',
    saveCss: 'Save CSS',
    cssSaved: 'CSS saved.',
    cssSaveFailed: 'CSS save failed.',
    namedCustomCss: 'Named custom CSS'
  }
};

function createPort(overrides: Partial<AppearancePort> = {}): AppearancePort {
  return {
    applyState: vi.fn(),
    closeOtherPopovers: vi.fn(),
    saveCustomCss: vi.fn().mockResolvedValue({
      status: 'failed',
      code: 'custom-css-save-failed'
    }),
    ...overrides
  };
}

describe('AppearanceControls', () => {
  it('anchors the panel to the appearance trigger instead of the page', async () => {
    const user = userEvent.setup();
    render(
      <AppearanceControls
        bootstrap={bootstrap}
        port={createPort()}
        onFailure={vi.fn()}
        onReady={vi.fn()}
      />
    );
    const trigger = screen.getByRole('button', { name: 'Appearance' });

    await user.click(trigger);
    const panel = screen.getByRole('dialog', { name: 'Appearance' });
    const anchor = trigger.closest(
      '.easymde-toolbar-popover-anchor.easymde-toolbar-popover-appearance'
    );

    expect(anchor).not.toBeNull();
    expect(anchor?.contains(panel)).toBe(true);
  });

  it('opens an accessible popover, focuses the first field, and returns focus on Escape', async () => {
    const user = userEvent.setup();
    render(
      <AppearanceControls
        bootstrap={bootstrap}
        port={createPort()}
        onFailure={vi.fn()}
        onReady={vi.fn()}
      />
    );
    const trigger = screen.getByRole('button', { name: 'Appearance' });

    await user.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('dialog', { name: 'Appearance' }).hidden).toBe(false);
    expect(document.activeElement).toBe(
      screen.getByRole('combobox', { name: 'Article theme' })
    );

    await user.keyboard('{Escape}');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger);
  });

  it('keeps keyboard focus inside the open appearance dialog', async () => {
    const user = userEvent.setup();
    render(
      <AppearanceControls
        bootstrap={bootstrap}
        port={createPort()}
        onFailure={vi.fn()}
        onReady={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Appearance' }));
    const articleTheme = screen.getByRole('combobox', { name: 'Article theme' });
    const customCss = screen.getByRole('button', { name: 'Custom CSS' });
    expect(document.activeElement).toBe(articleTheme);

    await user.keyboard('{Shift>}{Tab}{/Shift}');
    expect(document.activeElement).toBe(customCss);

    await user.keyboard('{Tab}');
    expect(document.activeElement).toBe(articleTheme);
  });

  it('keeps internal actions open while the retained legacy document listener closes outside clicks', async () => {
    const user = userEvent.setup();
    let session: AppearanceControlsSession | undefined;
    const closeForLegacyDocumentClick = () => session?.close();
    document.addEventListener('click', closeForLegacyDocumentClick);

    try {
      render(
        <AppearanceControls
          bootstrap={bootstrap}
          port={createPort()}
          onFailure={vi.fn()}
          onReady={(nextSession) => {
            session = nextSession;
          }}
        />
      );
      const trigger = screen.getByRole('button', { name: 'Appearance' });
      await user.click(trigger);
      await user.click(screen.getByRole('button', { name: 'Custom CSS' }));

      expect(trigger.getAttribute('aria-expanded')).toBe('true');
      expect(screen.getByRole('textbox', { name: 'CSS name' })).not.toBeNull();
    } finally {
      document.removeEventListener('click', closeForLegacyDocumentClick);
    }
  });

  it('applies complete theme state for registered article, custom CSS, and code selections', async () => {
    const applyState = vi.fn();
    const user = userEvent.setup();
    render(
      <AppearanceControls
        bootstrap={bootstrap}
        port={createPort({ applyState })}
        onFailure={vi.fn()}
        onReady={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Appearance' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Article theme' }), 'theme:newsprint');
    expect(applyState).toHaveBeenLastCalledWith({
      markdownTheme: 'newsprint',
      codeTheme: 'atom-one-dark',
      customCssId: ''
    });

    await user.selectOptions(screen.getByRole('combobox', { name: 'Article theme' }), 'custom:writer-css');
    expect(applyState).toHaveBeenLastCalledWith({
      markdownTheme: 'custom',
      codeTheme: 'atom-one-dark',
      customCssId: 'writer-css'
    });

    await user.selectOptions(screen.getByRole('combobox', { name: 'Code theme' }), 'github');
    expect(applyState).toHaveBeenLastCalledWith({
      markdownTheme: 'custom',
      codeTheme: 'github',
      customCssId: 'writer-css'
    });
  });

  it('keeps custom CSS save single-flight and reports the authoritative result', async () => {
    let resolveSave: ((value: Awaited<ReturnType<AppearancePort['saveCustomCss']>>) => void) | undefined;
    const saveCustomCss = vi.fn().mockImplementation(() => new Promise((resolve) => {
      resolveSave = resolve;
    }));
    const user = userEvent.setup();
    render(
      <AppearanceControls
        bootstrap={bootstrap}
        port={createPort({ saveCustomCss })}
        onFailure={vi.fn()}
        onReady={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Appearance' }));
    await user.click(screen.getByRole('button', { name: 'Custom CSS' }));
    await user.type(screen.getByRole('textbox', { name: 'CSS name' }), 'New theme');
    const save = screen.getByRole('button', { name: 'Save CSS' });
    await user.click(save);
    await user.click(save);

    expect(saveCustomCss).toHaveBeenCalledTimes(1);
    expect((save as HTMLButtonElement).disabled).toBe(true);

    resolveSave?.({ status: 'failed', code: 'custom-css-save-failed' });
    await screen.findByText('CSS save failed.');
    expect((save as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows an authoritative failure when custom CSS saving throws', async () => {
    const onFailure = vi.fn();
    const user = userEvent.setup();
    render(
      <AppearanceControls
        bootstrap={bootstrap}
        port={createPort({ saveCustomCss: vi.fn().mockRejectedValue(new Error('session-expired')) })}
        onFailure={onFailure}
        onReady={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Appearance' }));
    await user.click(screen.getByRole('button', { name: 'Custom CSS' }));
    await user.click(screen.getByRole('button', { name: 'Save CSS' }));

    await screen.findByText('CSS save failed.');
    expect(onFailure).toHaveBeenCalledOnce();
  });
});
