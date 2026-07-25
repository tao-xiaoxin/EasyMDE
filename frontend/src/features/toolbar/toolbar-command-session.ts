import type { ToolbarCommand } from '../../contracts/bootstrap/toolbar-bootstrap';
import type {
  ToolbarCommandDocumentPort,
  ToolbarCommandDocumentSnapshot,
  ToolbarCommandSelection
} from '../../contracts/ports/toolbar-command-port';

export type ToolbarCommandSession = Readonly<{
  dispose: () => void;
  execute: (commandId: string) => boolean;
  owns: (commandId: string) => boolean;
}>;

type CreateToolbarCommandSessionOptions = Readonly<{
  commands: ReadonlyArray<ToolbarCommand>;
  document: ToolbarCommandDocumentPort;
  executeExternalCommand: (commandId: string) => unknown;
  linkText: string;
}>;

function validSelection(selection: ToolbarCommandSelection, value: string): boolean {
  return Number.isInteger(selection.start)
    && Number.isInteger(selection.end)
    && selection.start >= 0
    && selection.end >= selection.start
    && selection.end <= value.length
    && ['backward', 'forward', 'none'].includes(selection.direction);
}

function documentSnapshot(document: ToolbarCommandDocumentPort): ToolbarCommandDocumentSnapshot {
  const snapshot = document.getSnapshot();
  if (
    !snapshot
    || 'string' !== typeof snapshot.value
    || !snapshot.selection
    || !validSelection(snapshot.selection, snapshot.value)
  ) {
    throw new Error('toolbar-command-document-snapshot-invalid');
  }

  return snapshot;
}

function replacement(
  snapshot: ToolbarCommandDocumentSnapshot,
  value: string,
  start: number,
  end: number
): ToolbarCommandDocumentSnapshot {
  return {
    selection: {
      direction: snapshot.selection.direction,
      end,
      start
    },
    value
  };
}

function wrapSelection(
  snapshot: ToolbarCommandDocumentSnapshot,
  prefix: string,
  suffix: string,
  placeholder: string
): ToolbarCommandDocumentSnapshot {
  const { end, start } = snapshot.selection;
  const selected = snapshot.value.slice(start, end) || placeholder;

  return replacement(
    snapshot,
    snapshot.value.slice(0, start) + prefix + selected + suffix + snapshot.value.slice(end),
    start + prefix.length,
    start + prefix.length + selected.length
  );
}

function stripLineMarkup(line: string): string {
  return line
    .replace(/^\s{0,3}#{1,6}\s+/, '')
    .replace(/^\s{0,3}>\s?/, '')
    .replace(/^\s{0,3}(?:[-+*]\s+|\d+\.\s+)/, '');
}

function transformSelectedLines(
  snapshot: ToolbarCommandDocumentSnapshot,
  transform: (lines: ReadonlyArray<string>) => ReadonlyArray<string>
): ToolbarCommandDocumentSnapshot {
  const { end, start } = snapshot.selection;
  const lineStart = snapshot.value.lastIndexOf('\n', start - 1) + 1;
  const foundLineEnd = snapshot.value.indexOf('\n', end);
  const lineEnd = -1 === foundLineEnd ? snapshot.value.length : foundLineEnd;
  const transformed = transform(snapshot.value.slice(lineStart, lineEnd).split('\n')).join('\n');

  return replacement(
    snapshot,
    snapshot.value.slice(0, lineStart) + transformed + snapshot.value.slice(lineEnd),
    lineStart,
    lineStart + transformed.length
  );
}

function prefixLines(
  snapshot: ToolbarCommandDocumentSnapshot,
  prefix: string
): ToolbarCommandDocumentSnapshot {
  return transformSelectedLines(snapshot, (lines) => lines.map((line) => (
    line ? prefix + stripLineMarkup(line) : prefix.trim()
  )));
}

function orderedLines(snapshot: ToolbarCommandDocumentSnapshot): ToolbarCommandDocumentSnapshot {
  let index = 1;

  return transformSelectedLines(snapshot, (lines) => lines.map((line) => {
    if (!line.trim()) {
      return '';
    }
    const transformed = `${index}. ${stripLineMarkup(line)}`;
    index += 1;
    return transformed;
  }));
}

function headingLines(
  snapshot: ToolbarCommandDocumentSnapshot,
  level: number
): ToolbarCommandDocumentSnapshot {
  return transformSelectedLines(snapshot, (lines) => lines.map((line) => {
    const content = stripLineMarkup(line).trim();
    if (!content || 0 === level) {
      return content;
    }
    return `${'#'.repeat(level)} ${content}`;
  }));
}

function insertBlock(
  snapshot: ToolbarCommandDocumentSnapshot,
  prefix: string,
  suffix: string,
  placeholder: string
): ToolbarCommandDocumentSnapshot {
  const { end, start } = snapshot.selection;
  const content = snapshot.value.slice(start, end) || placeholder;
  const blockPrefix = `${start > 0 && '\n' !== snapshot.value[start - 1] ? '\n' : ''}${prefix}`;
  const blockSuffix = `${suffix}${end < snapshot.value.length && '\n' !== snapshot.value[end] ? '\n' : ''}`;

  return replacement(
    snapshot,
    snapshot.value.slice(0, start) + blockPrefix + content + blockSuffix + snapshot.value.slice(end),
    start + blockPrefix.length,
    start + blockPrefix.length + content.length
  );
}

function commandChange(
  command: ToolbarCommand,
  snapshot: ToolbarCommandDocumentSnapshot,
  linkText: string
): ToolbarCommandDocumentSnapshot | null {
  switch (command.action) {
    case 'wrap':
      return wrapSelection(snapshot, command.prefix ?? '', command.suffix ?? '', command.placeholder ?? '');
    case 'heading':
      return headingLines(snapshot, command.level ?? 2);
    case 'paragraph':
      return headingLines(snapshot, 0);
    case 'quote':
      return prefixLines(snapshot, command.linePrefix ?? '> ');
    case 'unorderedList':
      return prefixLines(snapshot, command.linePrefix ?? '- ');
    case 'orderedList':
      return orderedLines(snapshot);
    case 'codeFence':
      return insertBlock(snapshot, '```\n', '\n```', 'code');
    case 'mathBlock':
      return insertBlock(snapshot, '$$\n', '\n$$', 'E = mc^2');
    case 'link':
      return wrapSelection(snapshot, '[', '](https://)', linkText);
    case 'linePrefix':
      return prefixLines(snapshot, command.linePrefix ?? '');
    default:
      if (command.prefix || command.suffix) {
        return wrapSelection(snapshot, command.prefix ?? '', command.suffix ?? '', command.placeholder ?? '');
      }
      if (command.linePrefix) {
        return prefixLines(snapshot, command.linePrefix);
      }
      return null;
  }
}

function ownsCommand(command: ToolbarCommand): boolean {
  switch (command.action) {
    case 'wrap':
    case 'heading':
    case 'paragraph':
    case 'quote':
    case 'unorderedList':
    case 'orderedList':
    case 'codeFence':
    case 'mathBlock':
    case 'link':
    case 'linePrefix':
    case 'image':
      return true;
    default:
      return Boolean(command.prefix || command.suffix || command.linePrefix);
  }
}

export function createToolbarCommandSession({
  commands,
  document,
  executeExternalCommand,
  linkText
}: CreateToolbarCommandSessionOptions): ToolbarCommandSession {
  const commandMap = new Map(commands.map((command) => [command.id, command]));
  let active = true;

  return {
    dispose() {
      active = false;
    },
    execute(commandId: string): boolean {
      if (!active) {
        return false;
      }
      const command = commandMap.get(commandId);
      if (!command) {
        return false;
      }
      if ('image' === command.action) {
        return false !== executeExternalCommand(commandId);
      }
      const change = commandChange(command, documentSnapshot(document), linkText);
      if (!change) {
        return false;
      }
      document.applyTextChange(change);
      document.focus();
      return true;
    },
    owns(commandId: string): boolean {
      if (!active) {
        return false;
      }
      const command = commandMap.get(commandId);
      return Boolean(command && ownsCommand(command));
    }
  };
}
