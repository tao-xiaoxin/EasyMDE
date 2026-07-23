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
    { id: 'inlinecode', label: '行内代码', icon: 'code', surface: 'main', action: 'wrap', group: 'insert' },
    { id: 'codefence', label: '代码块', icon: 'media-code', surface: 'main', action: 'codeFence', group: 'insert' }
  ],
  shortcuts: {
    bold: { win: 'Ctrl+B', mac: 'Cmd+B' },
    paragraph: { win: 'Ctrl+0', mac: 'Cmd+0' },
    heading1: { win: 'Ctrl+1', mac: 'Cmd+1' },
    quote: { win: 'Ctrl+Shift+Q', mac: 'Cmd+Option+Q' },
    inlinecode: { win: 'Ctrl+`', mac: 'Cmd+`' },
    codefence: { win: 'Ctrl+Shift+K', mac: 'Cmd+Option+C' }
  },
  headingLabelFormat: '标题 %s',
  headingLevelLabel: '标题级别',
  headingsLabel: '标题',
  linkText: '链接文本'
};

describe('EditorToolbar', () => {
  it('renders the legacy command order, icon sources, and platform shortcut titles', () => {
    const { container } = render(
      <EditorToolbar bootstrap={bootstrap} platform="win" executeCommand={vi.fn()} />
    );

    const controls = Array.from(
      container.querySelectorAll<HTMLButtonElement>('.easymde-toolbar-button')
    );
    expect(controls.map((control) => control.getAttribute('aria-label'))).toEqual([
      '粗体',
      '标题',
      '引用',
      '行内代码',
      '代码块'
    ]);
    expect(screen.getByRole('button', { name: '粗体' }).title).toBe('粗体 (Ctrl+B)');
    expect(screen.getByRole('button', { name: '粗体' }).querySelector('.dashicons-editor-bold')).not.toBeNull();
    expect(screen.getByRole('button', { name: '代码块' }).textContent).toContain('</>');
    expect(container.querySelectorAll('.easymde-toolbar-divider')).toHaveLength(2);
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

    await user.click(screen.getByRole('button', { name: '标题' }));

    const menu = screen.getByRole('menu', { name: '标题' });
    expect(within(menu).getByText('标题级别')).toBeTruthy();
    expect(within(menu).getByRole('menuitem', { name: /段落/ })).toBeTruthy();
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
      'H1标题 1',
      'H2专题标题',
      'H0零级扩展标题',
      '段落Ctrl+0',
      '扩展标题命令'
    ]);
    expect(container.querySelector('.is-immersive-heading-menu')).toBe(menu);
  });

  it('exposes heading menu state and returns focus on Escape', async () => {
    const executeCommand = vi.fn();
    const user = userEvent.setup();
    render(
      <div>
        <EditorToolbar bootstrap={bootstrap} platform="win" executeCommand={executeCommand} />
        <button type="button">外部控件</button>
      </div>
    );
    const trigger = screen.getByRole('button', { name: '标题' });
    const outsideControl = screen.getByRole('button', { name: '外部控件' });

    await user.click(outsideControl);
    await user.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const menu = screen.getByRole('menu', { name: '标题' });
    const paragraph = within(menu).getByRole('menuitem', { name: /\u6bb5\u843d/ });
    const heading = within(menu).getByRole('menuitem', { name: /一级标题/ });
    expect(document.activeElement).toBe(outsideControl);

    await user.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(outsideControl);

    trigger.focus();
    await user.keyboard('{Enter}');
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(paragraph);
    await user.keyboard('{Escape}');

    await user.keyboard(' ');
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(paragraph);
    await user.keyboard('{Escape}');

    trigger.focus();
    await user.keyboard('{ArrowDown}');
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(paragraph);

    await user.keyboard('{End}');
    expect(document.activeElement).toBe(heading);

    await user.keyboard('{Home}');
    expect(document.activeElement).toBe(paragraph);

    await user.keyboard('{ArrowDown}');
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
