export type ImmersiveViewMode = 'source' | 'split' | 'preview';

export type DocumentStats = Readonly<{
  words: number;
  characters: number;
  minutes: number;
}>;

export type ImmersiveOutlineItem = Readonly<{
  level: number;
  text: string;
  line: number;
  position: number;
  index: number;
}>;

export type ImmersiveOutlineNode = Readonly<{
  item: ImmersiveOutlineItem;
  children: ReadonlyArray<ImmersiveOutlineNode>;
}>;

type MarkdownLine = Readonly<{
  line: string;
  lineNumber: number;
  position: number;
}>;

type MarkdownFence = Readonly<{
  length: number;
  marker: '`' | '~';
}>;

function markdownLinesOutsideFences(
  markdown: string
): ReadonlyArray<MarkdownLine> {
  let fence: MarkdownFence | null = null;
  let position = 0;

  return markdown.split('\n').flatMap((line, lineNumber) => {
    const linePosition = position;
    position += line.length + 1;
    const match = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line);
    const run = match?.[1];
    const suffix = match?.[2];

    if (fence) {
      if (
        run?.[0] === fence.marker &&
        run.length >= fence.length &&
        /^[ \t]*$/u.test(suffix ?? '')
      ) {
        fence = null;
      }
      return [];
    }

    if (run && suffix !== undefined) {
      const marker = run[0];
      if (
        ('`' === marker || '~' === marker) &&
        ('~' === marker || !suffix.includes('`'))
      ) {
        fence = { length: run.length, marker };
        return [];
      }
    }

    return [{ line, lineNumber, position: linePosition }];
  });
}

export function getDocumentStats(markdown: string): DocumentStats {
  const text = markdownLinesOutsideFences(markdown)
    .map(({ line }) => line)
    .join('\n')
    .replace(/[#*_~`>|()]/g, '')
    .replaceAll('[', '')
    .replaceAll(']', '');
  const words = text.trim() ? text.trim().split(/\s+/u).length : 0;
  const characters = text.replace(/\s/gu, '').length;
  return { words, characters, minutes: Math.max(1, Math.ceil(words / 200)) };
}

export function extractOutline(markdown: string): ImmersiveOutlineItem[] {
  let index = 0;
  return markdownLinesOutsideFences(markdown).flatMap(
    ({ line, lineNumber, position }) => {
      const match = /^ {0,3}(#{1,6})(?=$|[ \t])(.*)$/u.exec(line);
      if (!match) return [];
      const hashes = match[1];
      const tail = match[2];
      if (!hashes || undefined === tail) {
        throw new Error('immersive-outline-match-invalid');
      }
      const closingSequence = /[ \t]+#+[ \t]*$/u.exec(tail);
      const text = tail
        .slice(0, closingSequence?.index ?? tail.length)
        .trim();
      if (!text) return [];
      return [
        {
          level: hashes.length,
          text,
          line: lineNumber,
          position,
          index: index++
        }
      ];
    }
  );
}

export function buildOutlineTree(
  items: ReadonlyArray<ImmersiveOutlineItem>
): ReadonlyArray<ImmersiveOutlineNode> {
  const roots: Array<{
    item: ImmersiveOutlineItem;
    children: ImmersiveOutlineNode[];
  }> = [];
  const stack: Array<{
    item: ImmersiveOutlineItem;
    children: ImmersiveOutlineNode[];
  }> = [];
  let currentSection: ImmersiveOutlineNode | null = null;

  for (const [itemIndex, item] of items.entries()) {
    const node = { item, children: [] };
    const numberedSection = /^\d+\.\s*/u.test(item.text);
    if (0 === itemIndex || numberedSection) {
      roots.push(node);
      currentSection = numberedSection ? node : null;
      stack.splice(0, stack.length, node);
      continue;
    }
    if (!currentSection) {
      roots.push(node);
      stack.splice(0, stack.length, node);
      continue;
    }
    while (
      stack.length > 1 &&
      (stack[stack.length - 1]?.item.level ?? 0) >= item.level
    ) {
      stack.pop();
    }
    const parent = stack[stack.length - 1];
    if (!parent) throw new Error('immersive-outline-tree-parent-missing');
    parent.children.push(node);
    stack.push(node);
  }

  return roots;
}

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
