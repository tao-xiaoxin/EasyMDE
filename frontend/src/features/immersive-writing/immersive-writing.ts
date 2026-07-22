import type { DocumentSelection } from '../document-source/adapters/code-mirror-document-session';

export type WritingStatistics = Readonly<{
  characters: number;
  minutes: number;
  words: number;
}>;

export function calculateWritingStatistics(markdown: string): WritingStatistics {
  const text = markdown
    .replace(/```[\s\S]*?```/g, '')
    .replace(/[#*_~`>|[\]()]/g, '');
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return {
    characters: text.replace(/\s/g, '').length,
    minutes: Math.max(1, Math.ceil(words / 200)),
    words
  };
}

export function tableMarkdown(rows: number, columns: number, column: string, content: string): string {
  if (!Number.isInteger(rows) || rows < 1 || rows > 20) {
    throw new Error('immersive-table-rows-invalid');
  }
  if (!Number.isInteger(columns) || columns < 1 || columns > 20) {
    throw new Error('immersive-table-columns-invalid');
  }
  const header = `| ${Array.from({ length: columns }, (_, index) => `${column}${index + 1}`).join(' | ')} |`;
  const separator = `| ${Array.from({ length: columns }, () => '---').join(' | ')} |`;
  const row = `| ${Array.from({ length: columns }, () => content).join(' | ')} |`;
  return `${header}\n${separator}\n${Array.from({ length: Math.max(0, rows - 1) }, () => row).join('\n')}`;
}

export function insertTableAtSelection(
  value: string,
  selection: DocumentSelection,
  table: string
): Readonly<{ selection: DocumentSelection; value: string }> {
  const before = selection.start > 0 && '\n' !== value[selection.start - 1] ? '\n' : '';
  const after = selection.end >= value.length || '\n' !== value[selection.end] ? '\n' : '';
  const insertion = `${before}${table}${after}`;
  const cursor = selection.start + insertion.length;
  return {
    selection: { direction: 'none', end: cursor, start: cursor },
    value: value.slice(0, selection.start) + insertion + value.slice(selection.end)
  };
}
