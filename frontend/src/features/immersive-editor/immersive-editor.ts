export type ImmersiveViewMode = 'source' | 'split' | 'preview';

export type {
  DocumentStats,
  ImmersiveDocumentDerivationScanner,
  ImmersiveDocumentDerivations,
  ImmersiveOutlineItem,
  ImmersiveOutlineNode
} from './immersive-document-derivations';
export {
  buildOutlineTree,
  createDocumentDerivationScanner,
  deriveDocumentDerivations,
  extractOutline,
  getDocumentStats
} from './immersive-document-derivations';
export { derivePublishExcerpt } from './immersive-publish-excerpt';

export function tableMarkdown(rows: number, columns: number): string {
  if (
    !Number.isInteger(rows) ||
    !Number.isInteger(columns) ||
    rows < 1 ||
    rows > 20 ||
    columns < 1 ||
    columns > 20
  ) {
    throw new Error('immersive-table-dimensions-invalid');
  }
  const row = (value: string) =>
    `| ${Array.from({ length: columns }, () => value).join(' | ')} |`;
  return `\n${row('')}\n${row('---')}\n${Array.from({ length: Math.max(0, rows - 1) }, () => row('')).join('\n')}\n`;
}

/** A bounded table insertion separated from adjacent blocks by blank lines. */
export function separatedTableInsertion(
  value: string, start: number, end: number, rows: number, columns: number
): Readonly<{ caret: number; from: number; insert: string; to: number }> {
  const table = tableMarkdown(rows, columns).trim();
  const before = value.slice(0, start);
  const after = value.slice(end);
  const lead = !before || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  const trail = !after ? '\n' : after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n';
  return { caret: start + lead.length + table.length, from: start, insert: `${lead}${table}${trail}`, to: end };
}
