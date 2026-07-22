export type ImmersiveViewMode = 'source' | 'split' | 'preview';

export type ImmersiveOutlineItem = Readonly<{
  level: number;
  text: string;
  line: number;
  position: number;
  index: number;
}>;

export function getDocumentStats(markdown: string): Readonly<{
  words: number;
  characters: number;
  minutes: number;
}> {
  const words = markdown.trim() ? markdown.trim().split(/\s+/u).length : 0;
  const characters = Array.from(markdown).length;
  return { words, characters, minutes: Math.max(1, Math.ceil(words / 200)) };
}

export function extractOutline(markdown: string): ImmersiveOutlineItem[] {
  let inFence = false;
  let index = 0;
  let position = 0;
  return markdown.split('\n').flatMap((line, lineNumber) => {
    const linePosition = position;
    position += line.length + 1;
    if (/^\s*```/u.test(line)) {
      inFence = !inFence;
      return [];
    }
    if (inFence) return [];
    const match = /^(#{1,6})\s+(.+?)\s*#*$/u.exec(line);
    if (!match) return [];
    const hashes = match[1];
    const text = match[2];
    if (!hashes || !text) throw new Error('immersive-outline-match-invalid');
    return [
      {
        level: hashes.length,
        text,
        line: lineNumber,
        position: linePosition,
        index: index++
      }
    ];
  });
}

export function tableMarkdown(rows: number, columns: number): string {
  if (
    !Number.isInteger(rows) ||
    !Number.isInteger(columns) ||
    rows < 1 ||
    rows > 20 ||
    columns < 1 ||
    columns > 12
  ) {
    throw new Error('immersive-table-dimensions-invalid');
  }
  const row = (value: string) =>
    `| ${Array.from({ length: columns }, () => value).join(' | ')} |`;
  return `\n${row('')}\n${row('---')}\n${Array.from({ length: Math.max(0, rows - 1) }, () => row('')).join('\n')}\n`;
}
