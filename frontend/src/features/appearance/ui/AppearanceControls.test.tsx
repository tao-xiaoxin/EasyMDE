import { createElement } from '@wordpress/element';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { AppearanceBootstrap } from '../../../contracts/bootstrap/appearance-bootstrap';
import type { AppearancePort } from '../../../contracts/ports/appearance-port';
import {
  customCssDialogStrings,
  customCssVariables
} from '../../../test/fixtures/appearance-bootstrap';
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
    { id: 'github', label: 'GitHub' },
    { id: 'terminal-noir', label: 'Terminal Noir' }
  ],
  customCss: [{
    id: 'writer-css',
    name: 'Writer CSS',
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
    customCssTheme: 'Custom CSS theme',
    customCssDialog: customCssDialogStrings,
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
  it('renders the reference palette trigger and live theme accent in immersive mode', () => {
    render(
      <AppearanceControls
        bootstrap={bootstrap}
        port={createPort()}
        onFailure={vi.fn()}
        onReady={vi.fn()}
        variant="immersive"
      />
    );

    const trigger = screen.getByRole('button', { name: 'Appearance' });
    expect(trigger.querySelector('svg')).not.toBeNull();
    expect(
      trigger.querySelector('.easymde-immersive-theme-accent')?.getAttribute(
        'data-theme'
      )
    ).toBe('default');
    expect(trigger.querySelector('.dashicons')).toBeNull();
  });

  it('renders the translated custom CSS theme action in immersive mode', async () => {
    const user = userEvent.setup();
    render(
      <AppearanceControls
        bootstrap={bootstrap}
        port={createPort()}
        onFailure={vi.fn()}
        onReady={vi.fn()}
        variant="immersive"
      />
    );

    await user.click(screen.getByRole('button', { name: 'Appearance' }));

    expect(
      screen.getByRole('button', { name: 'Custom CSS theme' }).textContent
    ).toContain('Custom CSS theme');
  });

  it('opens Custom CSS as a dedicated immersive modal instead of expanding the theme popover', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <AppearanceControls
        bootstrap={bootstrap}
        port={createPort()}
        onFailure={vi.fn()}
        onReady={vi.fn()}
        immersiveTitle="Theme settings"
        variant="immersive"
      />
    );

    await user.click(screen.getByRole('button', { name: 'Appearance' }));
    await user.click(screen.getByRole('button', { name: 'Custom CSS theme' }));

    expect(
      screen.getByRole('dialog', { name: 'Custom CSS theme' })
      .getAttribute('aria-modal')
    ).toBe('true');
    expect(
      container.querySelector<HTMLElement>(
        '[role="dialog"][aria-label="Theme settings"]'
      )?.hidden
    ).toBe(true);
    expect(
      screen.queryByRole('textbox', { name: 'CSS name' })
    ).toBeNull();
    expect(screen.getByText('Localized note label')).not.toBeNull();
    expect(screen.getByText('Localized tip label')).not.toBeNull();
    expect(screen.getByText('Localized warning label')).not.toBeNull();
    expect(screen.getByText('Localized caution label')).not.toBeNull();
  });

  it('renders the complete reference Custom CSS dialog preview fixture', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <AppearanceControls
        bootstrap={bootstrap}
        port={createPort()}
        onFailure={vi.fn()}
        onReady={vi.fn()}
        variant="immersive"
      />
    );

    await user.click(screen.getByRole('button', { name: 'Appearance' }));
    await user.click(screen.getByRole('button', { name: 'Custom CSS theme' }));

    const dialog = screen.getByRole('dialog', { name: 'Custom CSS theme' });
    expect(
      within(dialog).getByRole('heading', {
        level: 1,
        name: 'Custom CSS theme'
      })
    ).not.toBeNull();
    expect(
      within(dialog).getByRole('heading', { level: 2, name: 'Preview' })
    ).not.toBeNull();
    expect(
      within(dialog).getByRole('heading', {
        level: 2,
        name: 'Theme variables'
      })
    ).not.toBeNull();

    const preview = container.querySelector(
      '.easymde-custom-theme-preview'
    );
    expect(preview).not.toBeNull();
    expect(preview?.querySelector('pre > code.code-block')?.textContent).toContain(
      'Hello, EasyMDE!'
    );
    expect(preview?.querySelector('a')?.textContent).toContain('Link preview');
    expect(preview?.querySelector('dl')?.textContent).toContain(
      'Definition list'
    );
    expect(preview?.querySelector('hr')).not.toBeNull();
    expect(preview?.querySelector('h3')?.textContent).toBe(
      'Tertiary heading and supporting content'
    );
    expect(preview?.querySelector('.footnotes')?.textContent).toBe(
      '[1] Footnote and supporting text color sample.'
    );
    const validity = within(dialog).getByText(
      customCssDialogStrings.unsavedChanges
    );
    expect(validity.querySelector('circle[cx="12"][cy="12"][r="10"]')).not.toBeNull();
    expect(validity.querySelector('path[d="m9 12 2 2 4-4"]')).not.toBeNull();
  });

  it('switches both immersive Custom CSS tab groups with pointer and keyboard activation', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <AppearanceControls
        bootstrap={bootstrap}
        port={createPort()}
        onFailure={vi.fn()}
        onReady={vi.fn()}
        variant="immersive"
      />
    );

    await user.click(screen.getByRole('button', { name: 'Appearance' }));
    await user.click(screen.getByRole('button', { name: 'Custom CSS theme' }));

    const categoryTabs = within(
      screen.getByRole('tablist', { name: 'Theme variable categories' })
    );
    const foundationTab = categoryTabs.getByRole('tab', {
      name: 'Foundation'
    });
    const blocksTab = categoryTabs.getByRole('tab', { name: 'Blocks' });
    expect(foundationTab.getAttribute('aria-selected')).toBe('true');
    expect(foundationTab.getAttribute('tabindex')).toBe('0');
    expect(blocksTab.getAttribute('tabindex')).toBe('-1');

    const foundationPanel = screen.getByRole('tabpanel', {
      name: 'Foundation'
    });
    foundationPanel.scrollTop = 32;
    await user.click(blocksTab);
    expect(
      container.querySelectorAll(
        '.easymde-immersive-custom-css-variable-list'
      )
    ).toHaveLength(1);
    await user.click(foundationTab);
    const returnedFoundationPanel = screen.getByRole('tabpanel', {
      name: 'Foundation'
    });
    expect(returnedFoundationPanel).not.toBe(foundationPanel);
    expect(returnedFoundationPanel.scrollTop).toBe(0);
    await user.click(blocksTab);
    expect(blocksTab.getAttribute('aria-selected')).toBe('true');
    const blocksPanel = screen.getByRole('tabpanel', { name: 'Blocks' });
    expect(blocksPanel.id).toBe(blocksTab.getAttribute('aria-controls'));
    expect(blocksPanel.getAttribute('aria-labelledby')).toBe(blocksTab.id);
    expect(within(blocksPanel).getByText('emphasisBackground')).not.toBeNull();
    expect(within(blocksPanel).getByText('selectionBackground')).not.toBeNull();
    expect(within(blocksPanel).getByText('Quote accent')).not.toBeNull();

    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(
      categoryTabs.getByRole('tab', { name: 'Code' })
    );
    expect(
      categoryTabs.getByRole('tab', { name: 'Code' }).getAttribute(
        'aria-selected'
      )
    ).toBe('true');
    await user.keyboard('{End}');
    expect(document.activeElement).toBe(
      categoryTabs.getByRole('tab', { name: 'Alerts' })
    );
    await user.keyboard('{Home}');
    expect(document.activeElement).toBe(foundationTab);

    await user.click(screen.getByRole('button', {
      name: /^Custom CSS code/u
    }));
    const targetTabs = within(
      screen.getByRole('tablist', { name: 'CSS target' })
    );
    const articleTab = targetTabs.getByRole('tab', { name: 'Article CSS' });
    const codeTab = targetTabs.getByRole('tab', { name: 'Code CSS' });
    expect(
      container.querySelectorAll(
        '.easymde-immersive-custom-css-code-content'
      )
    ).toHaveLength(1);
    expect(articleTab.getAttribute('aria-selected')).toBe('true');
    expect(articleTab.getAttribute('tabindex')).toBe('0');
    expect(codeTab.getAttribute('tabindex')).toBe('-1');

    articleTab.focus();
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(codeTab);
    expect(codeTab.getAttribute('aria-selected')).toBe('true');
    const codePanel = screen.getByRole('tabpanel', { name: 'Code CSS' });
    expect(codePanel.id).toBe(codeTab.getAttribute('aria-controls'));
    expect(codePanel.getAttribute('aria-labelledby')).toBe(codeTab.id);
    expect(screen.getByText('Code CSS help')).not.toBeNull();
    expect(screen.queryByRole('tabpanel', { name: 'Article CSS' })).toBeNull();
  });

  it('uses the existing authoritative Custom CSS save port and closes only after success', async () => {
    const user = userEvent.setup();
    const saveCustomCss = vi.fn().mockResolvedValue({
      status: 'saved',
      snapshot: {
        customCss: [{
          css: ':root { color: #1F2937; }',
          id: 'easymde-blue',
          name: 'EasyMDE Blue',
          scopedCss: '.easymde-rendered-content { color: #1F2937; }'
        }],
        state: {
          codeTheme: 'atom-one-dark',
          customCssId: 'easymde-blue',
          markdownTheme: 'custom'
        }
      }
    });
    render(
      <AppearanceControls
        bootstrap={bootstrap}
        port={createPort({ saveCustomCss })}
        onFailure={vi.fn()}
        onReady={vi.fn()}
        variant="immersive"
      />
    );

    await user.click(screen.getByRole('button', { name: 'Appearance' }));
    await user.click(screen.getByRole('button', { name: 'Custom CSS theme' }));
    await user.click(screen.getByRole('button', { name: 'Apply theme' }));

    expect(saveCustomCss).toHaveBeenCalledTimes(1);
    expect(saveCustomCss).toHaveBeenCalledWith(expect.objectContaining({
      id: '',
      name: 'EasyMDE Blue / EasyMDE Blue Code',
      css: expect.stringMatching(
        /--easymde-primary-color: #3B82F6;[\s\S]*code:not\(\.hljs\):not\(\[class\*="language-"\]\)[\s\S]*\.hljs-keyword/
      )
    }));
    expect(saveCustomCss.mock.calls[0]?.[0].css).not.toContain('.token-keyword');
    expect(saveCustomCss.mock.calls[0]?.[0].css).not.toContain(
      'code:not(.code-block)'
    );
    await waitFor(() => {
      expect(
        screen.queryByRole('dialog', { name: 'Custom CSS theme' })
      ).toBeNull();
    });
  });

  it('captures a changed theme-variable value before the React input event expires', async () => {
    const user = userEvent.setup();
    const saveCustomCss = vi.fn().mockResolvedValue({
      status: 'saved',
      snapshot: {
        customCss: bootstrap.customCss,
        state: {
          codeTheme: 'atom-one-dark',
          customCssId: 'new-theme',
          markdownTheme: 'custom'
        }
      }
    });
    render(
      <AppearanceControls
        bootstrap={bootstrap}
        port={createPort({ saveCustomCss })}
        onFailure={vi.fn()}
        onReady={vi.fn()}
        variant="immersive"
      />
    );

    await user.click(screen.getByRole('button', { name: 'Appearance' }));
    await user.click(screen.getByRole('button', { name: 'Custom CSS theme' }));
    const primaryColor = screen.getByRole('textbox', { name: 'Primary color' });
    await user.clear(primaryColor);
    await user.type(primaryColor, '#12ab34');
    await user.click(screen.getByRole('button', { name: 'Apply theme' }));

    expect(saveCustomCss).toHaveBeenCalledWith(expect.objectContaining({
      css: expect.stringContaining('--easymde-primary-color: #12AB34;')
    }));
  });

  it('creates a fresh immersive theme without appending or overwriting the selected Custom CSS', async () => {
    const user = userEvent.setup();
    const saveCustomCss = vi.fn().mockResolvedValue({
      status: 'saved',
      snapshot: {
        customCss: bootstrap.customCss,
        state: {
          codeTheme: 'atom-one-dark',
          customCssId: 'new-theme',
          markdownTheme: 'custom'
        }
      }
    });
    render(
      <AppearanceControls
        bootstrap={{
          ...bootstrap,
          state: {
            codeTheme: 'atom-one-dark',
            customCssId: 'writer-css',
            markdownTheme: 'custom'
          }
        }}
        port={createPort({ saveCustomCss })}
        onFailure={vi.fn()}
        onReady={vi.fn()}
        variant="immersive"
      />
    );

    await user.click(screen.getByRole('button', { name: 'Appearance' }));
    await user.click(screen.getByRole('button', { name: 'Custom CSS theme' }));
    await user.click(screen.getByRole('button', { name: 'Apply theme' }));

    const input = saveCustomCss.mock.calls[0]?.[0];
    expect(input).toEqual(expect.objectContaining({
      id: '',
      name: 'EasyMDE Blue / EasyMDE Blue Code'
    }));
    expect(input?.css).not.toContain('.note { color: navy; }');
  });

  it('persists the editable code theme name in the combined Custom CSS record name', async () => {
    const user = userEvent.setup();
    const saveCustomCss = vi.fn().mockResolvedValue({
      status: 'saved',
      snapshot: {
        customCss: bootstrap.customCss,
        state: {
          codeTheme: 'atom-one-dark',
          customCssId: 'new-theme',
          markdownTheme: 'custom'
        }
      }
    });
    render(
      <AppearanceControls
        bootstrap={bootstrap}
        port={createPort({ saveCustomCss })}
        onFailure={vi.fn()}
        onReady={vi.fn()}
        variant="immersive"
      />
    );

    await user.click(screen.getByRole('button', { name: 'Appearance' }));
    await user.click(screen.getByRole('button', { name: 'Custom CSS theme' }));
    const codeName = screen.getByRole('textbox', { name: 'Code theme name' });
    await user.clear(codeName);
    await user.type(codeName, 'Midnight Code');
    await user.click(screen.getByRole('button', { name: 'Apply theme' }));

    expect(saveCustomCss).toHaveBeenCalledWith(expect.objectContaining({
      name: 'EasyMDE Blue / Midnight Code'
    }));
  });

  it('keeps the immersive dialog active until an in-flight authoritative save completes', async () => {
    let resolveSave:
      | ((value: Awaited<ReturnType<AppearancePort['saveCustomCss']>>) => void)
      | undefined;
    const saveCustomCss = vi.fn().mockImplementation(
      () => new Promise((resolve) => {
        resolveSave = resolve;
      })
    );
    const user = userEvent.setup();
    render(
      <AppearanceControls
        bootstrap={bootstrap}
        port={createPort({ saveCustomCss })}
        onFailure={vi.fn()}
        onReady={vi.fn()}
        variant="immersive"
      />
    );

    await user.click(screen.getByRole('button', { name: 'Appearance' }));
    await user.click(screen.getByRole('button', { name: 'Custom CSS theme' }));
    await user.click(screen.getByRole('button', { name: 'Apply theme' }));
    await user.keyboard('{Escape}');

    expect(
      screen.getByRole('dialog', { name: 'Custom CSS theme' })
    ).not.toBeNull();
    expect(
      (screen.getByRole('button', { name: 'Close' }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
    expect(
      (screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement)
        .disabled
    ).toBe(true);

    resolveSave?.({
      status: 'saved',
      snapshot: {
        customCss: bootstrap.customCss,
        state: {
          codeTheme: 'atom-one-dark',
          customCssId: 'new-theme',
          markdownTheme: 'custom'
        }
      }
    });
    await waitFor(() => {
      expect(
        screen.queryByRole('dialog', { name: 'Custom CSS theme' })
      ).toBeNull();
    });
  });

  it('closes the immersive Custom CSS dialog with Escape and restores trigger focus', async () => {
    const user = userEvent.setup();
    render(
      <AppearanceControls
        bootstrap={bootstrap}
        port={createPort()}
        onFailure={vi.fn()}
        onReady={vi.fn()}
        variant="immersive"
      />
    );
    const trigger = screen.getByRole('button', { name: 'Appearance' });

    await user.click(trigger);
    await user.click(screen.getByRole('button', { name: 'Custom CSS theme' }));
    await user.keyboard('{Escape}');

    expect(
      screen.queryByRole('dialog', { name: 'Custom CSS theme' })
    ).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('renders the registered Terminal Noir palette instead of the generic fallback', async () => {
    const user = userEvent.setup();
    render(
      <AppearanceControls
        bootstrap={bootstrap}
        port={createPort()}
        onFailure={vi.fn()}
        onReady={vi.fn()}
        variant="immersive"
      />
    );

    await user.click(screen.getByRole('button', { name: 'Appearance' }));
    await user.click(screen.getByRole('button', { name: 'Code theme' }));
    const option = screen.getByRole('option', { name: /Terminal Noir/u });
    const colors = Array.from(option.querySelectorAll<HTMLElement>(
      '.easymde-immersive-theme-swatch > span'
    )).map((element) => element.style.background);

    expect(colors).toEqual(['rgb(13, 16, 23)', 'rgb(202, 209, 217)']);
  });

  it('moves focus through immersive theme options with the keyboard', async () => {
    const user = userEvent.setup();
    render(
      <AppearanceControls
        bootstrap={bootstrap}
        port={createPort()}
        onFailure={vi.fn()}
        onReady={vi.fn()}
        variant="immersive"
      />
    );

    await user.click(screen.getByRole('button', { name: 'Appearance' }));
    const select = screen.getByRole('button', { name: 'Article theme' });
    select.focus();
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(screen.getByRole('option', { name: /Default/u }));
    await user.keyboard('{End}');
    expect(document.activeElement).toBe(screen.getByRole('option', { name: /Writer CSS/u }));
    await user.keyboard('{Escape}');
    expect(document.activeElement).toBe(select);
  });

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

  it('opens an accessible popover without moving focus and returns focus on Escape', async () => {
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
    expect(document.activeElement).toBe(trigger);

    await user.keyboard('{Escape}');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger);
  });

  it('allows keyboard focus to follow the legacy non-modal popover order', async () => {
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
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Appearance' }));

    await user.keyboard('{Tab}');
    expect(document.activeElement).toBe(articleTheme);

    await user.keyboard('{Shift>}{Tab}{/Shift}');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Appearance' }));
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
