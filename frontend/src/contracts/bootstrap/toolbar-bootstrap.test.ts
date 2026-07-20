import { describe, expect, it } from 'vitest';

import { ToolbarBootstrapError, parseToolbarBootstrap } from './toolbar-bootstrap';

const validBootstrap = {
  commands: [
    {
      id: 'bold',
      label: '粗体',
      icon: 'editor-bold',
      surface: 'main',
      action: 'wrap',
      group: 'format'
    },
    {
      id: 'extension-command',
      label: '扩展命令',
      icon: 'admin-generic',
      surface: 'main',
      action: 'extensionAction',
      group: 'insert'
    }
  ],
  shortcuts: {
    bold: { win: 'Ctrl+B', mac: 'Cmd+B' },
    'extension-command': { win: '', mac: '' }
  },
  strings: { headings: '标题' }
};

describe('parseToolbarBootstrap', () => {
  it('preserves registry order and final PHP-translated labels', () => {
    const parsed = parseToolbarBootstrap(validBootstrap);

    expect(parsed.commands.map((command) => command.id)).toEqual(['bold', 'extension-command']);
    expect(parsed.commands.map((command) => command.label)).toEqual(['粗体', '扩展命令']);
    expect(parsed.headingsLabel).toBe('标题');
  });

  it('rejects duplicate command identities at the external boundary', () => {
    expect(() =>
      parseToolbarBootstrap({
        ...validBootstrap,
        commands: [validBootstrap.commands[0], validBootstrap.commands[0]]
      })
    ).toThrowError(new ToolbarBootstrapError('duplicate-command-id'));
  });

  it('rejects missing translated labels instead of inventing browser copy', () => {
    expect(() =>
      parseToolbarBootstrap({
        ...validBootstrap,
        commands: [{ ...validBootstrap.commands[0], label: '' }]
      })
    ).toThrowError(new ToolbarBootstrapError('invalid-command-label'));
  });

  it.each([
    ['invalid-bootstrap', null],
    ['invalid-commands', { ...validBootstrap, commands: {} }],
    ['invalid-shortcuts', { ...validBootstrap, shortcuts: [] }],
    ['invalid-strings', { ...validBootstrap, strings: [] }],
    [
      'invalid-command-shortcut',
      {
        ...validBootstrap,
        shortcuts: {
          ...validBootstrap.shortcuts,
          bold: { win: 42, mac: 'Cmd+B' }
        }
      }
    ],
    ['invalid-headings-label', { ...validBootstrap, strings: { headings: '' } }]
  ])('reports the stable %s boundary error', (code, input) => {
    expect(() => parseToolbarBootstrap(input)).toThrowError(new ToolbarBootstrapError(code));
  });
});
