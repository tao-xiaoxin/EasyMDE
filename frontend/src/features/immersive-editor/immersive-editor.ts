import { markdownLanguage } from '@codemirror/lang-markdown';
import { decodeHTMLStrict } from 'entities';
import type { SummaryMode } from '../../contracts/settings-center-settings';

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

type MarkdownTree = ReturnType<typeof markdownLanguage.parser.parse>;
type MarkdownCursor = ReturnType<MarkdownTree['cursor']>;

type SourceEdit = Readonly<{
  from: number;
  replacement: string;
  to: number;
}>;

type SourceRange = Readonly<{
  from: number;
  to: number;
}>;

function currentMarkdownNodeName(cursor: MarkdownCursor): string {
  return cursor.name;
}

const SUMMARY_SYNTAX_NODES = new Set([
  'CodeInfo',
  'CodeMark',
  'EmphasisMark',
  'HeaderMark',
  'HTMLTag',
  'ListMark',
  'QuoteMark',
  'StrikethroughMark',
  'SubscriptMark',
  'SuperscriptMark',
  'TableDelimiter',
  'TaskMarker'
]);

const SUMMARY_BLOCK_PREFIX_NODES = new Set([
  'HeaderMark',
  'ListMark',
  'QuoteMark',
  'TaskMarker'
]);

function summarySyntaxRangeEnd(
  cursor: MarkdownCursor,
  markdown: string,
  insideFencedCode: boolean
): number {
  if (
    !SUMMARY_BLOCK_PREFIX_NODES.has(cursor.name) &&
    !('CodeMark' === cursor.name && insideFencedCode)
  ) {
    return cursor.to;
  }

  let end = cursor.to;
  while (' ' === markdown[end] || '\t' === markdown[end]) end += 1;
  return end;
}

function collectExcludedSummaryRanges(
  cursor: MarkdownCursor,
  linkLabelEnd: number | null,
  insideFencedCode: boolean,
  markdown: string,
  edits: SourceEdit[],
  codeRanges: SourceRange[]
): void {
  if (['CodeBlock', 'FencedCode', 'InlineCode'].includes(cursor.name)) {
    codeRanges.push({ from: cursor.from, to: cursor.to });
  }

  if ('CodeBlock' === currentMarkdownNodeName(cursor)) {
    const codeText: string[] = [];
    if (cursor.firstChild()) {
      do {
        if ('CodeText' === currentMarkdownNodeName(cursor)) {
          codeText.push(markdown.slice(cursor.from, cursor.to));
        }
      } while (cursor.nextSibling());
      cursor.parent();
    }
    const lineStart = markdown.lastIndexOf('\n', cursor.from - 1) + 1;
    edits.push({
      from: Math.max(lineStart, cursor.from - 4),
      replacement: codeText.join(''),
      to: cursor.to
    });
    return;
  }

  if ('Table' === currentMarkdownNodeName(cursor)) {
    const rows: string[] = [];
    if (cursor.firstChild()) {
      do {
        if (
          ['TableHeader', 'TableRow'].includes(
            currentMarkdownNodeName(cursor)
          )
        ) {
          const cells: string[] = [];
          if (cursor.firstChild()) {
            do {
              if ('TableCell' === currentMarkdownNodeName(cursor)) {
                cells.push(
                  summarySource(markdown.slice(cursor.from, cursor.to)).trim()
                );
              }
            } while (cursor.nextSibling());
            cursor.parent();
          }
          rows.push(cells.join(' '));
        }
      } while (cursor.nextSibling());
      cursor.parent();
    }
    edits.push({
      from: cursor.from,
      replacement: rows.length
        ? [rows[0], '', ...rows.slice(1)].join('\n')
        : '',
      to: cursor.to
    });
    return;
  }

  if (['SetextHeading1', 'SetextHeading2'].includes(cursor.name)) {
    let headerMarkFrom = cursor.to;
    if (cursor.firstChild()) {
      do {
        if ('HeaderMark' === cursor.name) headerMarkFrom = cursor.from;
      } while (cursor.nextSibling());
      cursor.parent();
    }
    edits.push({
      from: cursor.from,
      replacement: summarySource(markdown.slice(cursor.from, headerMarkFrom)),
      to: cursor.to
    });
    return;
  }

  if ('HTMLBlock' === cursor.name) {
    edits.push({
      from: cursor.from,
      replacement: '',
      to: cursor.to
    });
    return;
  }

  if (
    [
      'Autolink',
      'Comment',
      'CommentBlock',
      'HorizontalRule',
      'Image',
      'LinkReference',
      'ProcessingInstruction',
      'ProcessingInstructionBlock'
    ].includes(cursor.name)
  ) {
    edits.push({ from: cursor.from, replacement: '', to: cursor.to });
    return;
  }

  if ('Escape' === cursor.name) {
    edits.push({ from: cursor.from, replacement: '', to: cursor.from + 1 });
    return;
  }

  if ('Entity' === cursor.name) {
    edits.push({
      from: cursor.from,
      replacement: decodeHTMLStrict(markdown.slice(cursor.from, cursor.to)),
      to: cursor.to
    });
    return;
  }

  if ('HardBreak' === cursor.name) {
    edits.push({ from: cursor.from, replacement: '\n', to: cursor.to });
    return;
  }

  if (
    ('URL' === cursor.name &&
      (null === linkLabelEnd || cursor.from > linkLabelEnd)) ||
    (null !== linkLabelEnd &&
      ['LinkMark', 'LinkLabel', 'LinkTitle'].includes(cursor.name))
  ) {
    edits.push({ from: cursor.from, replacement: '', to: cursor.to });
    return;
  }

  if (SUMMARY_SYNTAX_NODES.has(cursor.name)) {
    edits.push({
      from: cursor.from,
      replacement: '',
      to: summarySyntaxRangeEnd(cursor, markdown, insideFencedCode)
    });
    return;
  }

  let nextLinkLabelEnd = linkLabelEnd;
  if ('Link' === cursor.name) {
    nextLinkLabelEnd = null;
    if (cursor.firstChild()) {
      do {
        if (
          'LinkMark' === currentMarkdownNodeName(cursor) &&
          ']' === markdown.slice(cursor.from, cursor.to)
        ) {
          nextLinkLabelEnd = cursor.from;
          break;
        }
      } while (cursor.nextSibling());
      cursor.parent();
    }
    if (null === nextLinkLabelEnd) {
      throw new Error('immersive-summary-link-label-invalid');
    }
  }
  const nextInsideFencedCode =
    insideFencedCode || 'FencedCode' === cursor.name;
  if (!cursor.firstChild()) return;
  do {
    collectExcludedSummaryRanges(
      cursor,
      nextLinkLabelEnd,
      nextInsideFencedCode,
      markdown,
      edits,
      codeRanges
    );
  } while (cursor.nextSibling());
  cursor.parent();
}

function rangesOverlap(left: SourceRange, right: SourceRange): boolean {
  return left.from < right.to && right.from < left.to;
}

function collectSummaryMathEdits(
  markdown: string,
  edits: SourceEdit[],
  codeRanges: ReadonlyArray<SourceRange>
): void {
  const patterns = [
    { closingLength: 2, expression: /\$\$([\s\S]+?)\$\$/gu, openingLength: 2 },
    { closingLength: 2, expression: /\\\[([\s\S]+?)\\\]/gu, openingLength: 2 },
    { closingLength: 2, expression: /\\\(([\s\S]+?)\\\)/gu, openingLength: 2 },
    { closingLength: 1, expression: /(?<!\\)\$([^\n$]+?)(?<!\\)\$/gu, openingLength: 1 }
  ] as const;
  const candidates: Array<SourceRange & { closingLength: number; openingLength: number; priority: number }> = [];

  for (const [priority, pattern] of patterns.entries()) {
    for (const match of markdown.matchAll(pattern.expression)) {
      if (undefined === match.index) {
        throw new Error('immersive-summary-math-range-unavailable');
      }
      candidates.push({
        closingLength: pattern.closingLength,
        from: match.index,
        openingLength: pattern.openingLength,
        priority,
        to: match.index + match[0].length
      });
    }
  }

  candidates.sort(
    (left, right) => left.from - right.from || left.priority - right.priority
  );
  const mathRanges: typeof candidates = [];
  for (const candidate of candidates) {
    const previous = mathRanges[mathRanges.length - 1];
    if (!previous || !rangesOverlap(previous, candidate)) {
      mathRanges.push(candidate);
    }
  }

  const sortedCodeRanges = [...codeRanges].sort(
    (left, right) => left.from - right.from || left.to - right.to
  );
  edits.sort((left, right) => left.from - right.from || left.to - right.to);
  const removedEdits = new Set<SourceEdit>();
  const delimiterEdits: SourceEdit[] = [];
  let codeIndex = 0;
  let editIndex = 0;

  for (const range of mathRanges) {
    while (true) {
      const currentCodeRange = sortedCodeRanges[codeIndex];
      if (!currentCodeRange || currentCodeRange.to > range.from) break;
      codeIndex += 1;
    }
    const codeRange = sortedCodeRanges[codeIndex];
    if (codeRange && rangesOverlap(codeRange, range)) continue;

    while (true) {
      const currentEdit = edits[editIndex];
      if (!currentEdit || currentEdit.to > range.from) break;
      editIndex += 1;
    }
    let currentEditIndex = editIndex;
    let excludedByContainer = false;
    let overlapsPartially = false;
    const containedEdits: SourceEdit[] = [];
    while (true) {
      const edit = edits[currentEditIndex];
      if (!edit || edit.from >= range.to) break;
      if (edit.from <= range.from && edit.to >= range.to) {
        excludedByContainer = true;
        break;
      }
      if (range.from <= edit.from && edit.to <= range.to) {
        containedEdits.push(edit);
        currentEditIndex += 1;
        continue;
      }
      overlapsPartially = true;
      break;
    }
    if (excludedByContainer || overlapsPartially) continue;
    for (const edit of containedEdits) removedEdits.add(edit);
    delimiterEdits.push(
      {
        from: range.from,
        replacement: '',
        to: range.from + range.openingLength
      },
      {
        from: range.to - range.closingLength,
        replacement: '',
        to: range.to
      }
    );
  }

  let writeIndex = 0;
  for (const edit of edits) {
    if (removedEdits.has(edit)) continue;
    edits[writeIndex] = edit;
    writeIndex += 1;
  }
  edits.length = writeIndex;
  for (const edit of delimiterEdits) edits.push(edit);
}

function summarySource(markdown: string): string {
  const edits: SourceEdit[] = [];
  const codeRanges: SourceRange[] = [];
  collectExcludedSummaryRanges(
    markdownLanguage.parser.parse(markdown).cursor(),
    null,
    false,
    markdown,
    edits,
    codeRanges
  );
  collectSummaryMathEdits(markdown, edits, codeRanges);
  edits.sort((left, right) => left.from - right.from);
  let position = 0;
  let result = '';
  for (const edit of edits) {
    if (
      edit.from < position ||
      edit.to < edit.from ||
      edit.to > markdown.length
    ) {
      throw new Error('immersive-summary-source-edits-invalid');
    }
    result += markdown.slice(position, edit.from) + edit.replacement;
    position = edit.to;
  }
  return result + markdown.slice(position);
}

export function derivePublishExcerpt(
  markdown: string,
  mode: SummaryMode
): string | null {
  if ('manual' === mode) return null;
  const limit = 'auto-55' === mode ? 55 : 100;
  return Array.from(summarySource(markdown)).slice(0, limit).join('');
}

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
