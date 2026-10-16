import { markdownLanguage } from '@codemirror/lang-markdown';

import type { ToolbarCommand } from '../../contracts/bootstrap/toolbar-bootstrap';
import type {
  ToolbarCommandDocumentPort,
  ToolbarCommandDocumentSnapshot,
  ToolbarCommandSelection
} from '../../contracts/ports/toolbar-command-port';
import { markdownLineStarts } from '../../shared/markdown/markdown-line-model';

export type ToolbarCommandSession = Readonly<{
  dispose: () => void;
  execute: (commandId: string) => boolean;
  owns: (commandId: string) => boolean;
  plan: (commandId: string) => ToolbarCommandPlan | null;
}>;

export type ToolbarCommandPlan = Readonly<{
  change: Readonly<{
    changes: Readonly<{ from: number; insert: string; to: number }>;
    selection: ToolbarCommandSelection;
    value: string;
  }>;
  expected: ToolbarCommandDocumentSnapshot;
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

// Source lines keep their own terminator so a transformation can rebuild a
// CRLF document without mixing line endings or losing a trailing newline.
type MarkdownLine = Readonly<{
  contentEnd: number;
  end: number;
  start: number;
  terminator: string;
}>;

type SetextHeadingBlock = Readonly<{
  contentEndLine: number;
  contentStartLine: number;
  headerLine: number;
}>;

const EMPTY_ATX_HEADING_LINE = /^[ \t]{0,3}#{1,6}[ \t]*$/u;

function markdownLines(value: string): ReadonlyArray<MarkdownLine> {
  const starts = markdownLineStarts(value);

  return starts.map((start, index) => {
    const next = starts[index + 1];
    const end = undefined === next ? value.length : next;
    const raw = value.slice(start, end);
    const terminator = raw.endsWith('\r\n')
      ? '\r\n'
      : raw.endsWith('\n')
        ? '\n'
        : raw.endsWith('\r')
          ? '\r'
          : '';

    return { contentEnd: end - terminator.length, end, start, terminator };
  });
}

function markdownParserValue(
  value: string,
  lines: ReadonlyArray<MarkdownLine>
): string {
  return lines
    .map((line) =>
      value.slice(line.start, line.contentEnd) + (line.terminator ? '\n' : '')
    )
    .join('');
}

function lineIndexAtStarts(starts: ReadonlyArray<number>, position: number): number {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if ((starts[middle] ?? 0) <= position) low = middle;
    else high = middle - 1;
  }
  return low;
}

function lineAt(lines: ReadonlyArray<MarkdownLine>, index: number): MarkdownLine {
  const line = lines[index];
  if (!line) {
    throw new Error('toolbar-command-markdown-line-missing');
  }

  return line;
}

function lineIndexAt(lines: ReadonlyArray<MarkdownLine>, position: number): number {
  let low = 0;
  let high = lines.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (lineAt(lines, middle).start <= position) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }

  return low;
}

// A Setext underline belongs to the whole heading block above it, and the block
// boundary must come from the Markdown parser: a neighbouring `---` inside
// fenced or indented code is content, not an underline, and a heading block may
// span several body lines. Only the parser knows where that block starts, where
// it ends, and which line carries the underline.
function setextHeadingBlocks(
  value: string,
  lines: ReadonlyArray<MarkdownLine>,
  firstLine: number,
  lastLine: number
): ReadonlyArray<SetextHeadingBlock> {
  const blocks: SetextHeadingBlock[] = [];
  const parserValue = markdownParserValue(value, lines);
  const parserLineStarts = markdownLineStarts(parserValue);
  const cursor = markdownLanguage.parser.parse(parserValue).cursor();
  const visit = (): void => {
    do {
      if ('SetextHeading1' === cursor.name || 'SetextHeading2' === cursor.name) {
        const contentStartLine = lineIndexAtStarts(parserLineStarts, cursor.from);
        const headerLine = lineIndexAtStarts(
          parserLineStarts,
          Math.max(cursor.from, cursor.to - 1)
        );
        if (headerLine <= contentStartLine) {
          throw new Error('toolbar-command-setext-heading-invalid');
        }
        if (headerLine >= firstLine && contentStartLine <= lastLine) {
          blocks.push({
            contentEndLine: headerLine - 1,
            contentStartLine,
            headerLine
          });
        }
      }
      if (cursor.firstChild()) {
        visit();
        cursor.parent();
      }
    } while (cursor.nextSibling());
  };
  visit();

  return blocks;
}

function headingLineContent(line: string, level: number): string {
  if (EMPTY_ATX_HEADING_LINE.test(line)) {
    return 0 === level ? '' : '#'.repeat(level);
  }
  const content = stripLineMarkup(line).trim();
  if (!content || 0 === level) {
    return content;
  }

  return `${'#'.repeat(level)} ${content}`;
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
  const lines = markdownLines(snapshot.value);
  const { end, start } = snapshot.selection;
  const firstLine = lineIndexAt(lines, start);
  const lastLine = lineIndexAt(lines, end);
  const blocks = setextHeadingBlocks(snapshot.value, lines, firstLine, lastLine);
  const removedLines = new Set<number>();
  const transformedLines = new Set<number>();
  let rangeStartLine = firstLine;
  let rangeEndLine = lastLine;
  for (const block of blocks) {
    removedLines.add(block.headerLine);
    let contentSelected = false;
    for (let line = block.contentStartLine; line <= block.contentEndLine; line += 1) {
      if (line >= firstLine && line <= lastLine) {
        contentSelected = true;
        transformedLines.add(line);
      }
    }
    // The underline belongs to the entire heading block, so the complete block
    // stays inside the edited range and the underline never survives as body
    // text or turns another line into a new heading. When the selection covers
    // only the underline, the nearest content line above it receives the target
    // level instead of leaving the heading behind as plain text.
    if (!contentSelected) {
      transformedLines.add(block.contentEndLine);
    }
    rangeStartLine = Math.min(rangeStartLine, block.contentStartLine);
    rangeEndLine = Math.max(rangeEndLine, block.headerLine);
  }
  for (let line = firstLine; line <= lastLine; line += 1) {
    if (!removedLines.has(line)) {
      transformedLines.add(line);
    }
  }

  let transformed = '';
  let lastTerminator = '';
  let selectionStart = -1;
  let selectionEnd = -1;
  let offset = lineAt(lines, rangeStartLine).start;
  for (let line = rangeStartLine; line <= rangeEndLine; line += 1) {
    if (removedLines.has(line)) {
      continue;
    }
    const source = lineAt(lines, line);
    const text = transformedLines.has(line)
      ? headingLineContent(snapshot.value.slice(source.start, source.contentEnd), level)
      : snapshot.value.slice(source.start, source.contentEnd);
    if (transformedLines.has(line)) {
      if (selectionStart < 0) {
        selectionStart = offset;
      }
      selectionEnd = offset + text.length;
    }
    transformed += text + source.terminator;
    lastTerminator = source.terminator;
    offset += text.length + source.terminator.length;
  }
  if (selectionStart < 0) {
    throw new Error('toolbar-command-heading-selection-missing');
  }
  // The removed underline takes its own terminator with it. When it ends the
  // source without one, the previous line's terminator would otherwise become a
  // new trailing blank line.
  if (
    removedLines.has(rangeEndLine)
    && '' === lineAt(lines, rangeEndLine).terminator
    && '' !== lastTerminator
    && transformed.endsWith(lastTerminator)
  ) {
    transformed = transformed.slice(0, -lastTerminator.length);
  }

  return replacement(
    snapshot,
    snapshot.value.slice(0, lineAt(lines, rangeStartLine).start)
      + transformed
      + snapshot.value.slice(lineAt(lines, rangeEndLine).end),
    selectionStart,
    selectionEnd
  );
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

function minimalChange(
  before: ToolbarCommandDocumentSnapshot,
  after: ToolbarCommandDocumentSnapshot
): ToolbarCommandPlan {
  let from = 0;
  while (
    from < before.value.length
    && from < after.value.length
    && before.value[from] === after.value[from]
  ) from += 1;
  let beforeTo = before.value.length;
  let afterTo = after.value.length;
  while (
    beforeTo > from
    && afterTo > from
    && before.value[beforeTo - 1] === after.value[afterTo - 1]
  ) {
    beforeTo -= 1;
    afterTo -= 1;
  }
  return {
    change: {
      changes: {
        from,
        insert: after.value.slice(from, afterTo),
        to: beforeTo
      },
      selection: after.selection,
      value: after.value
    },
    expected: before
  };
}

export function createToolbarCommandSession({
  commands,
  document,
  executeExternalCommand,
  linkText
}: CreateToolbarCommandSessionOptions): ToolbarCommandSession {
  const commandMap = new Map(commands.map((command) => [command.id, command]));
  let active = true;
  const planCommand = (commandId: string): ToolbarCommandPlan | null => {
    if (!active) return null;
    const command = commandMap.get(commandId);
    if (!command || !ownsCommand(command) || 'image' === command.action) {
      return null;
    }
    const snapshot = documentSnapshot(document);
    const change = commandChange(command, snapshot, linkText);
    return change ? minimalChange(snapshot, change) : null;
  };

  return {
    dispose() {
      active = false;
    },
    plan: planCommand,
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
      const plan = planCommand(commandId);
      if (!plan) {
        return false;
      }
      document.applyTextChange({
        selection: plan.change.selection,
        value: plan.change.value
      });
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
