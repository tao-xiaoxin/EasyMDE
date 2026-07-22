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

export function getDocumentStats(markdown: string): DocumentStats {
  const text = markdown
    .replace(/```[\s\S]*?```/gu, '')
    .replace(/[#*_~`>|()]/g, '')
    .replaceAll('[', '')
    .replaceAll(']', '');
  const words = text.trim() ? text.trim().split(/\s+/u).length : 0;
  const characters = Array.from(text.replace(/\s/gu, '')).length;
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
