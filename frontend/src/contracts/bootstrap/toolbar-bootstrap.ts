export type ToolbarCommand = Readonly<{
  id: string;
  label: string;
  icon: string;
  surface: string;
  action: string;
  group: string;
}>;

export type ToolbarShortcut = Readonly<{
  win: string;
  mac: string;
}>;

export type ToolbarBootstrap = Readonly<{
  commands: ReadonlyArray<ToolbarCommand>;
  shortcuts: Readonly<Record<string, ToolbarShortcut>>;
  headingsLabel: string;
}>;

export class ToolbarBootstrapError extends Error {
  public readonly code: string;

  public constructor(code: string) {
    super(code);
    this.name = 'ToolbarBootstrapError';
    this.code = code;
  }
}

function objectValue(value: unknown, code: string): Record<string, unknown> {
  if (!value || 'object' !== typeof value || Array.isArray(value)) {
    throw new ToolbarBootstrapError(code);
  }

  return value as Record<string, unknown>;
}

function requiredString(value: unknown, code: string): string {
  if ('string' !== typeof value || '' === value.trim()) {
    throw new ToolbarBootstrapError(code);
  }

  return value;
}

function parseCommand(value: unknown): ToolbarCommand {
  const command = objectValue(value, 'invalid-command');

  return {
    id: requiredString(command.id, 'invalid-command-id'),
    label: requiredString(command.label, 'invalid-command-label'),
    icon: requiredString(command.icon, 'invalid-command-icon'),
    surface: requiredString(command.surface, 'invalid-command-surface'),
    action: requiredString(command.action, 'invalid-command-action'),
    group: requiredString(command.group, 'invalid-command-group')
  };
}

function parseShortcut(value: unknown): ToolbarShortcut {
  if (undefined === value) {
    return { win: '', mac: '' };
  }

  const shortcut = objectValue(value, 'invalid-command-shortcut');
  if (
    ('string' !== typeof shortcut.win && undefined !== shortcut.win) ||
    ('string' !== typeof shortcut.mac && undefined !== shortcut.mac)
  ) {
    throw new ToolbarBootstrapError('invalid-command-shortcut');
  }

  return {
    win: 'string' === typeof shortcut.win ? shortcut.win : '',
    mac: 'string' === typeof shortcut.mac ? shortcut.mac : ''
  };
}

export function parseToolbarBootstrap(value: unknown): ToolbarBootstrap {
  const bootstrap = objectValue(value, 'invalid-bootstrap');
  if (!Array.isArray(bootstrap.commands)) {
    throw new ToolbarBootstrapError('invalid-commands');
  }

  const shortcutValues = objectValue(bootstrap.shortcuts, 'invalid-shortcuts');
  const strings = objectValue(bootstrap.strings, 'invalid-strings');
  const commandIds = new Set<string>();
  const commands = bootstrap.commands.map((value) => {
    const command = parseCommand(value);
    if (commandIds.has(command.id)) {
      throw new ToolbarBootstrapError('duplicate-command-id');
    }
    commandIds.add(command.id);
    return command;
  });
  const shortcuts: Record<string, ToolbarShortcut> = {};

  for (const command of commands) {
    shortcuts[command.id] = parseShortcut(shortcutValues[command.id]);
  }

  return {
    commands,
    shortcuts,
    headingsLabel: requiredString(strings.headings, 'invalid-headings-label')
  };
}
