import { createElement } from '@wordpress/element';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react';
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
    { id: 'default', label: 'Default', defaultCodeTheme: 'atom-one-dark' },
    { id: 'newsprint', label: 'Newsprint', defaultCodeTheme: 'fullstack-blue' }
  ],
  canManageCustomCss: true,
  codeThemeExplicit: false,
  codeThemes: [
    { id: 'atom-one-dark', label: 'Atom One Dark' },
    { id: 'github', label: 'GitHub' },
    { id: 'terminal-noir', label: 'Terminal Noir' },
    { id: 'fullstack-blue', label: 'Fullstack Blue' }
  ],
  customCss: [{
    id: 'writer-css',
    articleThemeName: 'Writer Article',
    codeThemeName: 'Writer Code',
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
    cssNameDuplicate: 'This theme name is already in use. Choose another name and try again.',
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
    previewCustomCss: vi.fn().mockResolvedValue({
      scopedCss: '',
      status: 'ready'
    }),
    saveCustomCss: vi.fn().mockResolvedValue({
      status: 'failed',
      code: 'custom-css-save-failed'
    }),
    ...overrides
  };
}

describe('AppearanceControls', () => {
  it('uses the local palette icon and shared dropdown chevron in ordinary mode', () => {
    render(
      <AppearanceControls
        bootstrap={bootstrap}
        port={createPort()}
        onFailure={vi.fn()}
        onReady={vi.fn()}
      />
    );
    const trigger = screen.getByRole('button', { name: 'Appearance' });

    expect(
      trigger.querySelector('.easymde-toolbar-icon-appearance')
    ).not.toBeNull();
    expect(trigger.querySelector('.easymde-toolbar-chevron')).not.toBeNull();
    expect(trigger.querySelector('.dashicons')).toBeNull();
  });

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

  it('hides the immersive custom CSS action without the required capability', async () => {
    const user = userEvent.setup();
    render(
      <AppearanceControls
        bootstrap={{ ...bootstrap, canManageCustomCss: false }}
        port={createPort()}
        onFailure={vi.fn()}
        onReady={vi.fn()}
        variant="immersive"
      />
    );

    await user.click(screen.getByRole('button', { name: 'Appearance' }));

    expect(
      screen.queryByRole('button', { name: 'Custom CSS theme' })
    ).toBeNull();
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

  it('keeps the dialog open and preserves edited names when the server rejects a duplicate theme name', async () => {
    const user = userEvent.setup();
    const onNotification = vi.fn();
    const saveCustomCss = vi.fn().mockResolvedValue({
      status: 'failed',
      code: 'easymde_duplicate_custom_css_name',
      message: 'Sensitive server detail'
    });
    render(
      <div className="easymde-editor">
        <AppearanceControls
          bootstrap={bootstrap}
          port={createPort({ saveCustomCss })}
          onFailure={vi.fn()}
          onNotification={onNotification}
          onReady={vi.fn()}
          variant="immersive"
        />
      </div>
    );

    await user.click(screen.getByRole('button', { name: 'Appearance' }));
    await user.click(screen.getByRole('button', { name: 'Custom CSS theme' }));

    const articleName = screen.getByRole('textbox', {
      name: 'Article theme name'
    });
    const codeName = screen.getByRole('textbox', { name: 'Code theme name' });
    await user.clear(articleName);
    await user.type(articleName, 'Existing Article');
    await user.clear(codeName);
    await user.type(codeName, 'Existing Code');

    const apply = screen.getByRole('button', { name: 'Apply theme' });
    apply.focus();
    await user.keyboard('{Enter}');

    const alert = await screen.findByRole('alert');
    expect(onNotification).not.toHaveBeenCalled();
    expect(screen.queryByText('Sensitive server detail')).toBeNull();
    const dialog = screen.getByRole('dialog', { name: 'Custom CSS theme' });
    expect(dialog.contains(alert)).toBe(true);
    expect(alert.classList.contains('is-compact')).toBe(true);
    expect(
      alert.parentElement?.classList.contains('is-dialog-compact')
    ).toBe(true);
    const dialogHeader = dialog.querySelector(':scope > header');
    expect(dialogHeader?.contains(alert)).toBe(true);
    expect(
      alert.parentElement?.nextElementSibling?.getAttribute('aria-label')
    ).toBe('Close');
    expect(alert.textContent).toContain(
      'This theme name is already in use. Choose another name and try again.'
    );
    expect((articleName as HTMLInputElement).value).toBe('Existing Article');
    expect((codeName as HTMLInputElement).value).toBe('Existing Code');
    expect(articleName.getAttribute('aria-invalid')).toBe('true');
    expect(codeName.getAttribute('aria-invalid')).toBe('true');
    const descriptionId = articleName.getAttribute('aria-describedby');
    expect(descriptionId).not.toBeNull();
    expect(codeName.getAttribute('aria-describedby')).toBe(descriptionId);
    expect(document.getElementById(descriptionId ?? '')?.textContent).toBe(
      'This theme name is already in use. Choose another name and try again.'
    );
    expect(document.activeElement).toBe(apply);
    const notificationClose = within(alert).getByRole('button', {
      name: 'Close'
    });
    const firstMainControl = within(dialog).getByRole('checkbox', {
      name: 'Completed task'
    });
    const dialogClose = dialogHeader?.querySelector<HTMLElement>(
      ':scope > button[aria-label="Close"]'
    );
    expect(dialogClose).not.toBeNull();
    apply.focus();
    await user.keyboard('{Tab}');
    expect(document.activeElement).toBe(notificationClose);
    await user.keyboard('{Tab}');
    expect(document.activeElement).toBe(dialogClose);
    await user.keyboard('{Tab}');
    expect(document.activeElement).toBe(articleName);
    codeName.focus();
    await user.keyboard('{Tab}');
    expect(document.activeElement).toBe(firstMainControl);
    await user.keyboard('{Shift>}{Tab}{/Shift}');
    expect(document.activeElement).toBe(codeName);
    notificationClose.focus();
    await user.keyboard('{Enter}');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(document.activeElement).toBe(apply);
    expect(saveCustomCss).toHaveBeenCalledWith(expect.objectContaining({
      articleThemeName: 'Existing Article',
      codeThemeName: 'Existing Code',
      id: '',
    }));

    apply.focus();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('alert')).not.toBeNull();
    await user.type(articleName, ' updated');

    expect(screen.queryByRole('alert')).toBeNull();
    expect(articleName.getAttribute('aria-invalid')).toBeNull();
    expect(codeName.getAttribute('aria-invalid')).toBeNull();
    expect(articleName.getAttribute('aria-describedby')).toBeNull();
    expect(codeName.getAttribute('aria-describedby')).toBeNull();
  });

  it('keeps preview availability feedback separate from save errors', async () => {
    const user = userEvent.setup();
    render(
      <AppearanceControls
        bootstrap={bootstrap}
        port={createPort({
          previewCustomCss: vi.fn().mockResolvedValue({ status: 'invalid' })
        })}
        onFailure={vi.fn()}
        onReady={vi.fn()}
        variant="immersive"
      />
    );

    await user.click(screen.getByRole('button', { name: 'Appearance' }));
    await user.click(screen.getByRole('button', { name: 'Custom CSS theme' }));

    const status = await screen.findByRole('status');
    expect(status.textContent).toBe(customCssDialogStrings.previewInvalid);
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.getAttribute('aria-atomic')).toBe('true');
    expect(screen.queryByRole('alert')).toBeNull();
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
    const previewCode = preview?.querySelector('pre > code.code-block.hljs');
    expect(previewCode?.textContent).toContain('Hello, EasyMDE!');
    expect(previewCode?.querySelector('.hljs-keyword')?.textContent).toBe(
      'const'
    );
    expect(previewCode?.querySelector('.hljs-string')).not.toBeNull();
    expect(previewCode?.querySelector('.hljs-comment')).not.toBeNull();
    expect(previewCode?.querySelector('.hljs-title.function_')?.textContent).toBe(
      'renderTheme'
    );
    expect(previewCode?.querySelector('[class^="token-"]')).toBeNull();
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
          articleThemeName: 'EasyMDE Blue',
          codeThemeName: 'EasyMDE Blue Code',
          css: ':root { color: #1F2937; }',
          id: 'easymde-blue',
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
      articleThemeName: 'EasyMDE Blue',
      codeThemeName: 'EasyMDE Blue Code',
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

  it('limits immersive Custom CSS names by Unicode code point', async () => {
    const user = userEvent.setup();
    const symbol = String.fromCodePoint(0x1f3a8);
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
    await user.click(screen.getByRole('button', { name: 'Custom CSS theme' }));
    const articleName = screen.getByRole('textbox', { name: 'Article theme name' });
    const codeName = screen.getByRole('textbox', { name: 'Code theme name' });

    fireEvent.change(articleName, { target: { value: symbol.repeat(20) } });
    fireEvent.change(codeName, { target: { value: symbol.repeat(31) } });

    expect((articleName as HTMLInputElement).value).toBe(symbol.repeat(20));
    expect((codeName as HTMLInputElement).value).toBe(symbol.repeat(30));
    expect(screen.getByText('20/30')).not.toBeNull();
    expect(screen.getByText('30/30')).not.toBeNull();
  });

  it('renders only server-scoped authored CSS in the live preview', async () => {
    const user = userEvent.setup();
    const authoredCss = 'h2 { color: #12ab34; }';
    const invalidCss = `${authoredCss}{`;
    const unavailableCss = `${authoredCss}{{`;
    const repeatedInvalidCss = `${authoredCss}{{{`;
    const previewCustomCss = vi.fn().mockImplementation((css: string) => {
      if (css.includes(repeatedInvalidCss)) {
        return Promise.resolve({ status: 'invalid' });
      }
      if (css.includes(unavailableCss)) {
        return Promise.reject(new Error('synthetic-network-error'));
      }
      if (css.includes(invalidCss)) {
        return Promise.resolve({ status: 'invalid' });
      }
      return Promise.resolve({
        scopedCss:
          '.easymde-immersive-workspace__custom-css-preview-content h2 { color: rgb(18, 171, 52); }',
        status: 'ready'
      });
    });
    render(
      <AppearanceControls
        bootstrap={bootstrap}
        port={createPort({ previewCustomCss })}
        onFailure={vi.fn()}
        onReady={vi.fn()}
        variant="immersive"
      />
    );

    await user.click(screen.getByRole('button', { name: 'Appearance' }));
    await user.click(screen.getByRole('button', { name: 'Custom CSS theme' }));
    await user.click(
      screen.getByRole('button', { name: /Custom CSS code/ })
    );
    const editor = screen.getByRole('textbox', { name: 'Custom CSS code' });
    fireEvent.change(editor, { target: { value: authoredCss } });
    expect((editor as HTMLTextAreaElement).value).toBe(authoredCss);

    await waitFor(() => {
      expect(previewCustomCss.mock.calls.at(-1)?.[0]).toContain(authoredCss);
    });
    await waitFor(() => {
      expect(
        document.querySelector(
          '.easymde-immersive-custom-css-preview style'
        )?.textContent
      ).toContain(
        '.easymde-immersive-workspace__custom-css-preview-content h2'
      );
    });

    const validPreview = document.querySelector(
      '.easymde-immersive-custom-css-preview style'
    )?.textContent;
    fireEvent.change(editor, { target: { value: invalidCss } });
    expect((editor as HTMLTextAreaElement).value).toBe(invalidCss);
    await waitFor(() => {
      expect(previewCustomCss.mock.calls.at(-1)?.[0]).toContain(invalidCss);
      expect(screen.getByRole('status').textContent).toBe(
        'Fix invalid CSS to update the live preview.'
      );
    });
    expect(
      (screen.getByRole('button', {
        name: 'Apply theme'
      }) as HTMLButtonElement).disabled
    ).toBe(true);
    expect(
      document.querySelector(
        '.easymde-immersive-custom-css-preview style'
      )?.textContent
    ).toBe(validPreview);
    fireEvent.change(editor, { target: { value: unavailableCss } });
    expect((editor as HTMLTextAreaElement).value).toBe(unavailableCss);
    await waitFor(() => {
      expect(previewCustomCss.mock.calls.at(-1)?.[0]).toContain(unavailableCss);
      expect(
        screen.getByRole('status').textContent
      ).toBe('Live preview is temporarily unavailable.');
    });
    expect(
      (screen.getByRole('button', {
        name: 'Apply theme'
      }) as HTMLButtonElement).disabled
    ).toBe(false);
    fireEvent.change(editor, { target: { value: repeatedInvalidCss } });
    expect((editor as HTMLTextAreaElement).value).toBe(repeatedInvalidCss);
    await waitFor(() => {
      expect(previewCustomCss.mock.calls.at(-1)?.[0]).toContain(
        repeatedInvalidCss
      );
      expect(
        screen.getByRole('status').textContent
      ).toBe('Fix invalid CSS to update the live preview.');
    });
    expect(
      (screen.getByRole('button', {
        name: 'Apply theme'
      }) as HTMLButtonElement).disabled
    ).toBe(true);
    expect(
      document.querySelector(
        '.easymde-immersive-custom-css-preview style'
      )?.textContent
    ).toBe(validPreview);
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
      articleThemeName: 'EasyMDE Blue',
      codeThemeName: 'EasyMDE Blue Code'
    }));
    expect(input?.css).not.toContain('.note { color: navy; }');
  });

  it('persists the editable article and code theme names as separate fields', async () => {
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
      articleThemeName: 'EasyMDE Blue',
      codeThemeName: 'Midnight Code'
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
    expect(
      (screen.getByRole('button', { name: 'Reset all' }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
    expect(
      (screen.getByRole('textbox', {
        name: 'Article theme name'
      }) as HTMLInputElement).disabled
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

  it('omits the custom CSS editing entry from the ordinary appearance panel', async () => {
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

    expect(screen.queryByRole('button', { name: 'Custom CSS' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save CSS' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'CSS name' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Custom CSS' })).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Article theme' })).not.toBeNull();
    expect(screen.getByRole('combobox', { name: 'Code theme' })).not.toBeNull();
  });

  it('shows each saved custom theme name only in its owned embedded menu', async () => {
    const user = userEvent.setup();
    const applyState = vi.fn();
    render(
      <AppearanceControls
        bootstrap={bootstrap}
        port={createPort({ applyState })}
        onFailure={vi.fn()}
        onReady={vi.fn()}
        variant="embedded"
      />
    );

    const articleTheme = screen.getByRole('combobox', {
      name: 'Article theme'
    });
    await user.click(articleTheme);
    const articleOptions = screen.getByRole('listbox', {
      name: 'Article theme'
    });
    expect(articleOptions.textContent).not.toContain('Named custom CSS');
    expect(articleOptions.textContent).toContain('Writer Article');
    expect(articleOptions.textContent).not.toContain('Writer Code');
    await user.click(screen.getByRole('option', { name: 'Writer Article' }));

    expect(applyState).toHaveBeenLastCalledWith({
      markdownTheme: 'custom',
      codeTheme: 'atom-one-dark',
      customCssId: 'writer-css'
    }, false);

    const codeTheme = screen.getByRole('combobox', { name: 'Code theme' });
    expect(codeTheme.textContent).toContain('Writer Code');
    await user.click(codeTheme);
    const codeOptions = screen.getByRole('listbox', { name: 'Code theme' });
    expect(codeOptions.textContent).not.toContain('Named custom CSS');
    expect(codeOptions.textContent).toContain('Writer Code');
    expect(codeOptions.textContent).not.toContain('Writer Article');
    expect(
      screen.getByRole('option', { name: 'Writer Code' }).getAttribute(
        'aria-selected'
      )
    ).toBe('true');

    await user.click(screen.getByRole('option', { name: 'GitHub' }));
    expect(applyState).toHaveBeenLastCalledWith({
      markdownTheme: 'custom',
      codeTheme: 'github',
      customCssId: 'writer-css'
    }, true);
  });

  it('uses a custom code label to select its paired Custom CSS preset', async () => {
    const applyState = vi.fn();
    const user = userEvent.setup();
    render(
      <AppearanceControls
        bootstrap={{
          ...bootstrap,
          state: {
            markdownTheme: 'newsprint',
            codeTheme: 'github',
            customCssId: ''
          },
          codeThemeExplicit: true
        }}
        port={createPort({ applyState })}
        onFailure={vi.fn()}
        onReady={vi.fn()}
        variant="embedded"
      />
    );

    await user.click(screen.getByRole('combobox', { name: 'Code theme' }));
    await user.click(screen.getByRole('option', { name: 'Writer Code' }));

    expect(applyState).toHaveBeenLastCalledWith({
      markdownTheme: 'custom',
      codeTheme: 'atom-one-dark',
      customCssId: 'writer-css'
    }, false);
    expect(
      screen.getByRole('combobox', { name: 'Article theme' }).textContent
    ).toContain('Writer Article');
    expect(
      screen.getByRole('combobox', { name: 'Code theme' }).textContent
    ).toContain('Writer Code');
  });

  it('reuses immersive article and code palettes in the embedded theme menus', async () => {
    const user = userEvent.setup();
    render(
      <AppearanceControls
        bootstrap={bootstrap}
        port={createPort()}
        onFailure={vi.fn()}
        onReady={vi.fn()}
        variant="embedded"
      />
    );

    const articleTheme = screen.getByRole('combobox', {
      name: 'Article theme'
    });
    expect(
      articleTheme.querySelector<HTMLElement>(
        '.easymde-ordinary-select-swatch'
      )?.style.background
    ).toBe('rgb(51, 51, 51)');

    await user.click(articleTheme);
    expect(
      screen.getByRole('option', { name: 'Writer Article' })
        .querySelector<HTMLElement>('.easymde-ordinary-select-swatch')
        ?.style.background
    ).toBe('rgb(220, 38, 38)');
    await user.keyboard('{Escape}');

    const codeTheme = screen.getByRole('combobox', { name: 'Code theme' });
    const triggerColors = Array.from(
      codeTheme.querySelectorAll<HTMLElement>(
        '.easymde-ordinary-select-swatch > span'
      )
    ).map((element) => element.style.background);
    expect(triggerColors).toEqual(['rgb(40, 44, 52)', 'rgb(171, 178, 191)']);

    await user.click(codeTheme);
    const terminalNoir = screen.getByRole('option', {
      name: 'Terminal Noir'
    });
    expect(
      Array.from(terminalNoir.querySelectorAll<HTMLElement>(
        '.easymde-ordinary-select-swatch > span'
      )).map((element) => element.style.background)
    ).toEqual(['rgb(13, 16, 23)', 'rgb(202, 209, 217)']);
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

  it('renders the distinct associated Fullstack Blue code palette', async () => {
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
    const option = screen.getByRole('option', { name: /Fullstack Blue/u });
    const colors = Array.from(option.querySelectorAll<HTMLElement>(
      '.easymde-immersive-theme-swatch > span'
    )).map((element) => element.style.background);

    expect(colors).toEqual(['rgb(40, 44, 52)', 'rgb(171, 178, 191)']);
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
    expect(document.activeElement).toBe(screen.getByRole('option', { name: /Writer Article/u }));
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

  it('keeps the immersive dialog open while the retained legacy document listener closes the popover', async () => {
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
          variant="immersive"
        />
      );
      const trigger = screen.getByRole('button', { name: 'Appearance' });
      await user.click(trigger);
      await user.click(screen.getByRole('button', { name: 'Custom CSS theme' }));

      expect(trigger.getAttribute('aria-expanded')).toBe('false');
      expect(
        screen.getByRole('dialog', { name: 'Custom CSS theme' })
      ).not.toBeNull();
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
      codeTheme: 'fullstack-blue',
      customCssId: ''
    }, false);

    await user.selectOptions(screen.getByRole('combobox', { name: 'Article theme' }), 'custom:writer-css');
    expect(applyState).toHaveBeenLastCalledWith({
      markdownTheme: 'custom',
      codeTheme: 'atom-one-dark',
      customCssId: 'writer-css'
    }, false);

    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Code theme' }),
      'theme:github'
    );
    expect(applyState).toHaveBeenLastCalledWith({
      markdownTheme: 'custom',
      codeTheme: 'github',
      customCssId: 'writer-css'
    }, true);

    await user.selectOptions(screen.getByRole('combobox', { name: 'Article theme' }), 'theme:default');
    expect(applyState).toHaveBeenLastCalledWith({
      markdownTheme: 'default',
      codeTheme: 'github',
      customCssId: ''
    }, true);
  });

  it('uses the default article code theme for implicit custom CSS in immersive mode', async () => {
    const applyState = vi.fn();
    const user = userEvent.setup();
    render(
      <AppearanceControls
        bootstrap={{
          ...bootstrap,
          state: {
            markdownTheme: 'newsprint',
            codeTheme: 'fullstack-blue',
            customCssId: ''
          }
        }}
        port={createPort({ applyState })}
        onFailure={vi.fn()}
        onReady={vi.fn()}
        variant="immersive"
      />
    );

    await user.click(screen.getByRole('button', { name: 'Appearance' }));
    await user.click(screen.getByRole('button', { name: 'Article theme' }));
    await user.click(screen.getByRole('option', { name: /Writer Article/u }));

    expect(applyState).toHaveBeenLastCalledWith({
      markdownTheme: 'custom',
      codeTheme: 'atom-one-dark',
      customCssId: 'writer-css'
    }, false);
    expect(
      screen.getByRole('button', { name: 'Code theme' }).textContent
    ).toContain('Writer Code');
  });

  it('applies the implicit custom CSS code theme after a successful save', async () => {
    const applyState = vi.fn();
    const saveCustomCss = vi.fn().mockResolvedValue({
      status: 'saved',
      snapshot: {
        customCss: [{
          id: 'saved-css',
          articleThemeName: 'Saved Article',
          codeThemeName: 'Saved Code',
          css: '.saved { color: green; }',
          scopedCss: '.easymde-rendered-content .saved { color: green; }'
        }],
        state: {
          markdownTheme: 'custom',
          codeTheme: 'fullstack-blue',
          customCssId: 'saved-css'
        }
      }
    });
    const user = userEvent.setup();
    render(
      <AppearanceControls
        bootstrap={{
          ...bootstrap,
          state: {
            markdownTheme: 'newsprint',
            codeTheme: 'fullstack-blue',
            customCssId: ''
          }
        }}
        port={createPort({ applyState, saveCustomCss })}
        onFailure={vi.fn()}
        onReady={vi.fn()}
        variant="immersive"
      />
    );

    await user.click(screen.getByRole('button', { name: 'Appearance' }));
    await user.click(screen.getByRole('button', { name: 'Custom CSS theme' }));
    await user.click(screen.getByRole('button', { name: 'Apply theme' }));

    await waitFor(() => {
      expect(applyState).toHaveBeenLastCalledWith({
        markdownTheme: 'custom',
        codeTheme: 'atom-one-dark',
        customCssId: 'saved-css'
      }, false);
    });
  });

  it('does not publish a saved Custom CSS snapshot when applying it fails', async () => {
    const applyState = vi.fn(() => {
      throw new Error('synthetic apply failure');
    });
    const saveCustomCss = vi.fn().mockResolvedValue({
      status: 'saved',
      snapshot: {
        customCss: [{
          id: 'saved-css',
          articleThemeName: 'Saved Article',
          codeThemeName: 'Saved Code',
          css: '.saved { color: green; }',
          scopedCss: '.easymde-rendered-content .saved { color: green; }'
        }],
        state: {
          markdownTheme: 'custom',
          codeTheme: 'atom-one-dark',
          customCssId: 'saved-css'
        }
      }
    });
    const onFailure = vi.fn();
    const user = userEvent.setup();
    render(
      <AppearanceControls
        bootstrap={bootstrap}
        port={createPort({ applyState, saveCustomCss })}
        onFailure={onFailure}
        onReady={vi.fn()}
        variant="immersive"
      />
    );

    await user.click(screen.getByRole('button', { name: 'Appearance' }));
    await user.click(screen.getByRole('button', { name: 'Custom CSS theme' }));
    await user.click(screen.getByRole('button', { name: 'Apply theme' }));

    await screen.findByText('CSS save failed.');
    expect(onFailure).toHaveBeenCalledOnce();
    expect(screen.queryByText('CSS saved.')).toBeNull();
    const dialog = screen.getByRole('dialog', { name: 'Custom CSS theme' });
    await user.click(
      within(dialog).getAllByRole('button', { name: 'Close' })[0] as HTMLElement
    );
    await user.click(screen.getByRole('button', { name: 'Appearance' }));
    expect(
      screen.getByRole('button', { name: 'Article theme' }).textContent
    ).toContain('Default');
  });

  it('keeps a valid persisted code theme authoritative when the article theme changes', async () => {
    const applyState = vi.fn();
    const user = userEvent.setup();
    render(
      <AppearanceControls
        bootstrap={{ ...bootstrap, codeThemeExplicit: true }}
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
    }, true);
  });

  it('does not retain an explicit code theme intent when applying it fails', async () => {
    const applyState = vi.fn()
      .mockImplementationOnce(() => {
        throw new Error('synthetic apply failure');
      });
    const onFailure = vi.fn();
    const user = userEvent.setup();
    render(
      <AppearanceControls
        bootstrap={bootstrap}
        port={createPort({ applyState })}
        onFailure={onFailure}
        onReady={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Appearance' }));
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Code theme' }),
      'theme:terminal-noir'
    );
    expect(onFailure).toHaveBeenCalledOnce();

    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Article theme' }),
      'theme:newsprint'
    );
    expect(applyState).toHaveBeenLastCalledWith({
      markdownTheme: 'newsprint',
      codeTheme: 'fullstack-blue',
      customCssId: ''
    }, false);
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
        variant="immersive"
      />
    );

    await user.click(screen.getByRole('button', { name: 'Appearance' }));
    await user.click(screen.getByRole('button', { name: 'Custom CSS theme' }));
    const articleName = screen.getByRole('textbox', {
      name: 'Article theme name'
    });
    await user.clear(articleName);
    await user.type(articleName, 'New theme');
    const save = screen.getByRole('button', { name: 'Apply theme' });
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
        variant="immersive"
      />
    );

    await user.click(screen.getByRole('button', { name: 'Appearance' }));
    await user.click(screen.getByRole('button', { name: 'Custom CSS theme' }));
    await user.click(screen.getByRole('button', { name: 'Apply theme' }));

    await screen.findByText('CSS save failed.');
    expect(onFailure).toHaveBeenCalledOnce();
  });
});
