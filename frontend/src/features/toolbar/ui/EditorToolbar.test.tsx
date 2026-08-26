import { createElement } from '@wordpress/element';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { ToolbarBootstrap } from '../../../contracts/bootstrap/toolbar-bootstrap';
import { EditorToolbar } from './EditorToolbar';

const bootstrap: ToolbarBootstrap = {
  commands: [
    { id: 'bold', label: '粗体', icon: 'editor-bold', surface: 'main', action: 'wrap', group: 'format' },
    { id: 'paragraph', label: '段落', icon: 'heading', surface: 'heading-menu', action: 'paragraph', group: 'heading' },
    { id: 'heading1', label: '一级标题', icon: 'heading', surface: 'heading-menu', action: 'heading', group: 'heading', level: 1, usesLevelLabel: true },
    { id: 'quote', label: '引用', icon: 'format-quote', surface: 'main', action: 'quote', group: 'block' },
    { id: 'inlinecode', label: '行内代码', icon: 'editor-code', surface: 'main', action: 'wrap', group: 'insert' },
    { id: 'codefence', label: '代码块', icon: 'media-code', surface: 'main', action: 'codeFence', group: 'insert' }
  ],
  shortcuts: {
    bold: { win: 'Ctrl+B', mac: 'Cmd+B' },
    paragraph: { win: 'Ctrl+0', mac: 'Cmd+0' },
    heading1: { win: 'Ctrl+1', mac: 'Cmd+1' },
    quote: { win: 'Ctrl+Shift+Q', mac: 'Cmd+Option+Q' },
    inlinecode: { win: 'Ctrl+Backquote', mac: 'Cmd+Backquote' },
    codefence: { win: 'Ctrl+Shift+K', mac: 'Cmd+Option+C' }
  },
  headingLabelFormat: '标题 %s',
  headingLevelLabel: '标题级别',
  headingsLabel: '标题',
  linkText: '链接文本',
  undoLabel: '撤销'
};

describe('EditorToolbar', () => {
  it('renders the ordinary command order with one local icon contract and platform shortcut titles', () => {
    const { container } = render(
      <EditorToolbar bootstrap={bootstrap} platform="win" executeCommand={vi.fn()} />
    );

    const controls = Array.from(
      container.querySelectorAll<HTMLButtonElement>('.easymde-toolbar-button')
    );
    expect(controls.map((control) => control.getAttribute('aria-label'))).toEqual([
      '撤销',
      '粗体',
      '标题',
      '引用',
      '行内代码',
      '代码块'
    ]);
    expect(screen.getByRole('button', { name: '粗体' }).title).toBe('粗体 (Ctrl+B)');
    expect(screen.getByRole('button', { name: '行内代码' }).title).toBe('行内代码 (Ctrl+`)');
    expect(screen.getByRole('button', { name: '粗体' }).querySelector('.easymde-toolbar-icon-bold')).not.toBeNull();
    expect(screen.getByRole('button', { name: '引用' }).querySelector('.easymde-toolbar-icon-quote')).not.toBeNull();
    expect(screen.getByRole('button', { name: '代码块' }).querySelector('.easymde-toolbar-icon-codefence')).not.toBeNull();
    expect(screen.getByRole('button', { name: '标题' }).textContent).toBe('H');
    expect(container.querySelector('.dashicons')).toBeNull();
    expect(container.querySelectorAll('.easymde-toolbar-divider')).toHaveLength(2);
  });

  it('renders one history-aware Undo control only in the ordinary toolbar', () => {
    const undo = vi.fn();
    const { rerender } = render(
      <EditorToolbar
        bootstrap={bootstrap}
        canUndo={false}
        platform="win"
        executeCommand={vi.fn()}
        undo={undo}
      />
    );

    const button = screen.getByRole('button', {
      name: '撤销'
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.querySelector('.easymde-toolbar-icon-undo')).not.toBeNull();
    expect(button.querySelector('path[d="M9 14 4 9l5-5"]')).not.toBeNull();
    expect(button.querySelector('path[d^="M3 12a9"]')).toBeNull();

    rerender(
      <EditorToolbar
        bootstrap={bootstrap}
        canUndo
        platform="win"
        executeCommand={vi.fn()}
        undo={undo}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    expect(undo).toHaveBeenCalledTimes(1);

    rerender(
      <EditorToolbar
        bootstrap={bootstrap}
        canUndo
        platform="win"
        executeCommand={vi.fn()}
        undo={undo}
        variant="immersive"
      />
    );
    expect(screen.queryByRole('button', { name: '撤销' })).toBeNull();
  });

  it('updates main command titles from the current platform binding without changing controls that never had hints', () => {
    const { rerender } = render(
      <EditorToolbar
        bootstrap={{
          ...bootstrap,
          shortcuts: {
            ...bootstrap.shortcuts,
            bold: { win: 'Ctrl+Alt+B', mac: 'Cmd+Option+B' }
          }
        }}
        platform="win"
        executeCommand={vi.fn()}
      />
    );
    const bold = screen.getByRole('button', { name: '粗体' });
    const headings = screen.getByRole('button', { name: '标题' });
    const undo = screen.getByRole('button', { name: '撤销' });

    expect(bold.title).toBe('粗体 (Ctrl+Alt+B)');
    expect(bold.getAttribute('aria-label')).toBe('粗体');
    expect(headings.title).toBe('标题');
    expect(headings.textContent).toBe('H');
    expect(undo.title).toBe('撤销');

    rerender(
      <EditorToolbar
        bootstrap={{
          ...bootstrap,
          shortcuts: {
            ...bootstrap.shortcuts,
            bold: { win: '', mac: 'Cmd+Option+B' }
          }
        }}
        platform="win"
        executeCommand={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: '粗体' }).title).toBe('粗体');
    expect(screen.getByRole('button', { name: '标题' }).title).toBe('标题');
    expect(screen.getByRole('button', { name: '撤销' }).title).toBe('撤销');
  });

  it('renders a compact ordinary heading menu without the paragraph command', async () => {
    const executeCommand = vi.fn();
    const user = userEvent.setup();
    const ordinaryBootstrap: ToolbarBootstrap = {
      ...bootstrap,
      commands: [
        ...bootstrap.commands,
        ...[2, 3, 4, 5, 6].map((level) => ({
          id: `heading${level}`,
          label: `${level}级标题`,
          icon: 'heading',
          surface: 'heading-menu',
          action: 'heading',
          group: 'heading',
          level
        }))
      ],
      shortcuts: {
        ...bootstrap.shortcuts,
        heading2: { win: 'Ctrl+2', mac: 'Cmd+2' },
        heading3: { win: 'Ctrl+3', mac: 'Cmd+3' },
        heading4: { win: 'Ctrl+4', mac: 'Cmd+4' },
        heading5: { win: 'Ctrl+5', mac: 'Cmd+5' },
        heading6: { win: 'Ctrl+6', mac: 'Cmd+6' }
      }
    };
    const { container } = render(
      <EditorToolbar
        bootstrap={ordinaryBootstrap}
        platform="win"
        executeCommand={executeCommand}
      />
    );

    const trigger = screen.getByRole('button', { name: '标题' });
    const menu = container.querySelector<HTMLDivElement>(
      '.easymde-toolbar-popover-headings [role="menu"]'
    );
    expect(menu).not.toBeNull();
    if (!menu) {
      throw new Error('ordinary-heading-menu-unavailable');
    }
    expect(menu.hidden).toBe(true);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');

    await user.click(trigger);
    expect(screen.getByRole('menu', { name: '标题' })).toBe(menu);
    expect(menu.hidden).toBe(false);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.getAttribute('data-easymde-command'))
    ).toEqual([
      'heading1',
      'heading2',
      'heading3',
      'heading4',
      'heading5',
      'heading6'
    ]);
    expect(
      within(menu).queryByRole('menuitem', { name: /段落/ })
    ).toBeNull();
    const headingBadges = Array.from(
      menu.querySelectorAll<HTMLElement>('.easymde-heading-menu-badge')
    );
    expect(headingBadges.map((badge) => badge.textContent)).toEqual([
      'H1',
      'H2',
      'H3',
      'H4',
      'H5',
      'H6'
    ]);
    expect(
      headingBadges.map((badge) => badge.dataset.headingLevel)
    ).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(menu.querySelector('.easymde-heading-mark-letter')).toBeNull();
    expect(menu.querySelector('.easymde-heading-mark-level')).toBeNull();
    expect(
      within(menu).getByRole('menuitem', { name: /3级标题/ }).textContent
    ).toBe('H33级标题Ctrl+3');

    const heading3 = within(menu).getByRole('menuitem', { name: /3级标题/ });
    expect(fireEvent.mouseDown(heading3)).toBe(false);
    await user.click(heading3);
    expect(executeCommand).toHaveBeenCalledWith('heading3');
    expect(menu.hidden).toBe(true);
  });

  it('shows current-platform H1-H6 bindings in the ordinary menu and removes cleared hints', async () => {
    const user = userEvent.setup();
    const commands = [1, 2, 3, 4, 5, 6].map((level) => ({
      id: `heading${level}`,
      label: `${level}级标题`,
      icon: 'heading',
      surface: 'heading-menu',
      action: 'heading',
      group: 'heading',
      level
    }));
    const customShortcuts = Object.fromEntries(
      commands.map((command, index) => [
        command.id,
        { win: `Ctrl+Alt+${index + 1}`, mac: `Cmd+Option+${index + 1}` }
      ])
    );
    const ordinaryBootstrap: ToolbarBootstrap = {
      ...bootstrap,
      commands,
      shortcuts: customShortcuts
    };
    const { rerender } = render(
      <EditorToolbar
        bootstrap={ordinaryBootstrap}
        platform="win"
        executeCommand={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: '标题' }));
    const menu = screen.getByRole('menu', { name: '标题' });
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) =>
          item.querySelector('.easymde-popover-item-shortcut')?.textContent
        )
    ).toEqual([
      'Ctrl+Alt+1',
      'Ctrl+Alt+2',
      'Ctrl+Alt+3',
      'Ctrl+Alt+4',
      'Ctrl+Alt+5',
      'Ctrl+Alt+6'
    ]);

    rerender(
      <EditorToolbar
        bootstrap={{
          ...ordinaryBootstrap,
          shortcuts: {
            ...customShortcuts,
            heading3: { win: '', mac: 'Cmd+Option+3' }
          }
        }}
        platform="win"
        executeCommand={vi.fn()}
      />
    );
    const heading3 = within(screen.getByRole('menu', { name: '标题' })).getByRole(
      'menuitem',
      { name: /3级标题/ }
    );
    expect(heading3.querySelector('.easymde-popover-item-shortcut')).toBeNull();
    expect(heading3.textContent).toBe('H33级标题');
    expect(heading3.textContent).not.toContain('Ctrl+3');
    expect(heading3.textContent).not.toContain('Ctrl+Alt+3');
  });

  it('preserves the documented Dashicons fallback for extension commands', () => {
    const extensionBootstrap: ToolbarBootstrap = {
      ...bootstrap,
      commands: [{
        id: 'extension-command',
        label: '扩展命令',
        icon: 'admin-generic',
        surface: 'main',
        action: 'wrap',
        group: 'format'
      }]
    };
    render(
      <EditorToolbar
        bootstrap={extensionBootstrap}
        platform="win"
        executeCommand={vi.fn()}
      />
    );

    expect(
      screen.getByRole('button', { name: '扩展命令' })
        .querySelector('.dashicons-admin-generic')
    ).not.toBeNull();
  });

  it('keeps registered heading-surface extensions inside the restored ordinary menu', async () => {
    const executeCommand = vi.fn();
    const user = userEvent.setup();
    const extensionBootstrap: ToolbarBootstrap = {
      ...bootstrap,
      commands: [
        ...bootstrap.commands,
        {
          id: 'extension-heading-command',
          label: '扩展标题命令',
          icon: 'admin-generic',
          surface: 'heading-menu',
          action: 'wrap',
          group: 'heading',
          prefix: '<heading>',
          suffix: '</heading>'
        }
      ]
    };
    render(
      <EditorToolbar
        bootstrap={extensionBootstrap}
        platform="win"
        executeCommand={executeCommand}
      />
    );

    await user.click(screen.getByRole('button', { name: '标题' }));
    const extension = within(
      screen.getByRole('menu', { name: '标题' })
    ).getByRole('menuitem', { name: /扩展标题命令/ });

    await user.click(extension);
    expect(executeCommand).toHaveBeenCalledWith('extension-heading-command');
  });

  it('preserves an extension icon when the public registry replaces a built-in command ID', () => {
    const extensionBootstrap: ToolbarBootstrap = {
      ...bootstrap,
      commands: [{
        id: 'bold',
        label: '替换粗体',
        icon: 'admin-generic',
        surface: 'main',
        action: 'wrap',
        group: 'format'
      }]
    };
    render(
      <EditorToolbar
        bootstrap={extensionBootstrap}
        platform="win"
        executeCommand={vi.fn()}
      />
    );

    const button = screen.getByRole('button', { name: '替换粗体' });
    expect(button.querySelector('.dashicons-admin-generic')).not.toBeNull();
    expect(button.querySelector('.easymde-toolbar-icon-bold')).toBeNull();
  });

  it('keeps the existing immersive icon behavior when an extension replaces a built-in command ID', () => {
    const extensionBootstrap: ToolbarBootstrap = {
      ...bootstrap,
      commands: [{
        id: 'bold',
        label: '替换粗体',
        icon: 'admin-generic',
        surface: 'main',
        action: 'wrap',
        group: 'format'
      }]
    };
    render(
      <EditorToolbar
        bootstrap={extensionBootstrap}
        platform="win"
        executeCommand={vi.fn()}
        variant="immersive"
      />
    );

    const button = screen.getByRole('button', { name: '替换粗体' });
    expect(button.querySelector('svg')).not.toBeNull();
    expect(button.querySelector('.dashicons-admin-generic')).toBeNull();
    expect(button.querySelector('.easymde-toolbar-icon-bold')).toBeNull();
  });

  it('renders the reference immersive group boundaries and distinct code icons', () => {
    const immersiveBootstrap: ToolbarBootstrap = {
      ...bootstrap,
      commands: [
        ...bootstrap.commands,
        {
          id: 'image',
          label: '图片',
          icon: 'format-image',
          surface: 'main',
          action: 'image',
          group: 'insert'
        }
      ]
    };
    const { container } = render(
      <EditorToolbar
        bootstrap={immersiveBootstrap}
        platform="win"
        executeCommand={vi.fn()}
        variant="immersive"
      />
    );

    expect(container.querySelectorAll('.easymde-toolbar-divider')).toHaveLength(5);
    expect(
      container.querySelector('.easymde-toolbar-divider + .easymde-toolbar-divider')
    ).not.toBeNull();
    expect(container.querySelector('[data-easymde-command="codefence"] svg')).not.toEqual(
      container.querySelector('[data-easymde-command="inlinecode"] svg')
    );
  });

  it('preserves the source selection on pointer activation and dispatches the command intent', async () => {
    const executeCommand = vi.fn();
    const user = userEvent.setup();
    render(<EditorToolbar bootstrap={bootstrap} platform="win" executeCommand={executeCommand} />);
    const bold = screen.getByRole('button', { name: '粗体' });
    const down = fireEvent.mouseDown(bold);

    expect(down).toBe(false);
    await user.click(bold);
    expect(executeCommand).toHaveBeenCalledWith('bold');
  });

  it('uses the reference heading-level structure in immersive mode', async () => {
    const user = userEvent.setup();
    const immersiveBootstrap: ToolbarBootstrap = {
      ...bootstrap,
      commands: [
        ...bootstrap.commands,
        {
          id: 'heading2',
          label: '专题标题',
          icon: 'heading',
          surface: 'heading-menu',
          action: 'heading',
          group: 'heading',
          level: 2
        },
        {
          id: 'heading0',
          label: '零级扩展标题',
          icon: 'heading',
          surface: 'heading-menu',
          action: 'heading',
          group: 'heading',
          level: 0
        },
        {
          id: 'extension-heading-command',
          label: '扩展标题命令',
          icon: 'admin-generic',
          surface: 'heading-menu',
          action: 'extensionHeading',
          group: 'heading'
        }
      ]
    };
    const { container } = render(
      <EditorToolbar
        bootstrap={immersiveBootstrap}
        platform="win"
        executeCommand={vi.fn()}
        variant="immersive"
      />
    );

    const trigger = screen.getByRole('button', { name: '标题' });
    expect(trigger.querySelector('.easymde-toolbar-text-icon')?.textContent).toBe('H');
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({
      bottom: 100.75,
      height: 30,
      left: 159.5,
      right: 207.5,
      top: 70.75,
      width: 48,
      x: 159.5,
      y: 70.75,
      toJSON: () => ({})
    });
    await user.click(trigger);

    const menu = screen.getByRole('menu', { name: '标题' });
    expect(menu.style.left).toBe('159.5px');
    expect(menu.style.top).toBe('106.75px');
    expect(within(menu).getByText('标题级别')).toBeTruthy();
    expect(within(menu).queryByRole('menuitem', { name: /段落/ })).toBeNull();
    expect(
      within(menu).getByRole('menuitem', { name: /扩展标题命令/ })
    ).toBeTruthy();
    expect(
      within(menu).getByRole('menuitem', { name: /专题标题/ })
    ).toBeTruthy();
    expect(
      within(menu).getByRole('menuitem', { name: /零级扩展标题/ })
    ).toBeTruthy();
    const heading = within(menu).getByRole('menuitem', { name: /标题 1/ });
    expect(heading.querySelector('[data-heading-level="1"]')?.textContent).toBe('H1');
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'H1标题 1Ctrl+1',
      'H2专题标题',
      'H0零级扩展标题',
      '扩展标题命令'
    ]);
    expect(
      heading.querySelector('.easymde-popover-item-shortcut')?.textContent
    ).toBe('Ctrl+1');
    for (const item of within(menu).getAllByRole('menuitem').slice(1)) {
      expect(item.querySelector('.easymde-popover-item-shortcut')).toBeNull();
    }
    expect(trigger.title).toBe('标题');
    expect(container.querySelector('.is-immersive-heading-menu')).toBe(menu);
  });

  it('keeps a longest heading shortcut visible inside the viewport edge', async () => {
    const user = userEvent.setup();
    const viewportWidth = vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(360);
    const headingOne = bootstrap.commands.find((command) => 'heading1' === command.id);
    if (!headingOne) throw new Error('heading-one-command-unavailable');
    const { container } = render(
      <EditorToolbar
        bootstrap={{
          ...bootstrap,
          commands: [headingOne],
          shortcuts: {
            heading1: {
              win: 'Ctrl+Alt+Shift+1',
              mac: 'Cmd+Ctrl+Option+Shift+1'
            }
          }
        }}
        platform="win"
        executeCommand={vi.fn()}
        variant="immersive"
      />
    );
    const trigger = screen.getByRole('button', { name: '标题' });
    const menu = container.querySelector<HTMLDivElement>('[role="menu"]');
    if (!menu) throw new Error('heading-menu-unavailable');
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({
      bottom: 100,
      height: 30,
      left: 330,
      right: 378,
      top: 70,
      width: 48,
      x: 330,
      y: 70,
      toJSON: () => ({})
    });
    vi.spyOn(menu, 'getBoundingClientRect').mockReturnValue({
      bottom: 144,
      height: 38,
      left: 330,
      right: 650,
      top: 106,
      width: 320,
      x: 330,
      y: 106,
      toJSON: () => ({})
    });

    try {
      await user.click(trigger);
      expect(menu.style.left).toBe('28px');
      expect(
        within(menu).getByRole('menuitem', { name: /标题 1/ }).textContent
      ).toBe('H1标题 1Ctrl+Alt+Shift+1');
    } finally {
      viewportWidth.mockRestore();
    }
  });

  it('positions the ordinary menu for a longest macOS shortcut without losing its trigger anchor', async () => {
    const user = userEvent.setup();
    let viewportWidth = 480;
    const viewport = vi
      .spyOn(window, 'innerWidth', 'get')
      .mockImplementation(() => viewportWidth);
    const headingOne = bootstrap.commands.find((command) => 'heading1' === command.id);
    if (!headingOne) throw new Error('heading-one-command-unavailable');
    const { container } = render(
      <EditorToolbar
        bootstrap={{
          ...bootstrap,
          commands: [headingOne],
          shortcuts: {
            heading1: {
              win: 'Ctrl+Alt+Shift+1',
              mac: 'Cmd+Ctrl+Option+Shift+1'
            }
          }
        }}
        platform="mac"
        executeCommand={vi.fn()}
      />
    );
    const trigger = screen.getByRole('button', { name: '标题' });
    const menu = container.querySelector<HTMLDivElement>('[role="menu"]');
    if (!menu) throw new Error('ordinary-heading-menu-unavailable');
    let triggerLeft = 430;
    vi.spyOn(trigger, 'getBoundingClientRect').mockImplementation(() => ({
      bottom: 130,
      height: 30,
      left: triggerLeft,
      right: triggerLeft + 48,
      top: 100,
      width: 48,
      x: triggerLeft,
      y: 100,
      toJSON: () => ({})
    }));
    vi.spyOn(menu, 'getBoundingClientRect').mockReturnValue({
      bottom: 176,
      height: 38,
      left: 430,
      right: 790,
      top: 138,
      width: 360,
      x: 430,
      y: 138,
      toJSON: () => ({})
    });

    try {
      await user.click(trigger);
      expect(menu.classList.contains('is-ordinary-heading-menu')).toBe(true);
      expect(menu.style.position).toBe('fixed');
      expect(menu.style.left).toBe('108px');
      expect(menu.style.top).toBe('138px');
      expect(
        menu.style.getPropertyValue('--easymde-heading-arrow-viewport-left')
      ).toBe('447px');
      expect(
        menu.style.getPropertyValue('--easymde-heading-arrow-viewport-top')
      ).toBe('130px');
      expect(
        within(menu).getByRole('menuitem', { name: /一级标题/ }).textContent
      ).toBe('H1一级标题Cmd+Ctrl+Option+Shift+1');

      viewportWidth = 1024;
      triggerLeft = 100;
      fireEvent(window, new Event('resize'));
      expect(menu.style.left).toBe('100px');
      expect(
        menu.style.getPropertyValue('--easymde-heading-arrow-viewport-left')
      ).toBe('117px');
    } finally {
      viewport.mockRestore();
    }
  });

  it('preserves immersive heading menu focus and Escape behavior', async () => {
    const executeCommand = vi.fn();
    const user = userEvent.setup();
    render(
      <div>
        <EditorToolbar
          bootstrap={bootstrap}
          platform="win"
          executeCommand={executeCommand}
          variant="immersive"
        />
        <button type="button">外部控件</button>
      </div>
    );
    const trigger = screen.getByRole('button', { name: '标题' });
    const outsideControl = screen.getByRole('button', { name: '外部控件' });

    await user.click(outsideControl);
    await user.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const menu = screen.getByRole('menu', { name: '标题' });
    const heading = within(menu).getByRole('menuitem', { name: /标题 1/ });
    expect(document.activeElement).toBe(outsideControl);

    await user.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(outsideControl);

    trigger.focus();
    await user.keyboard('{Enter}');
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(heading);
    await user.keyboard('{Escape}');

    await user.keyboard(' ');
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(heading);
    await user.keyboard('{Escape}');

    trigger.focus();
    await user.keyboard('{ArrowDown}');
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(heading);

    await user.keyboard('{End}');
    expect(document.activeElement).toBe(heading);

    await user.keyboard('{Home}');
    expect(document.activeElement).toBe(heading);

    await user.keyboard('{Escape}');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger);

    await user.keyboard('{ArrowUp}');
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(heading);

    await user.click(outsideControl);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(outsideControl);
  });
});
