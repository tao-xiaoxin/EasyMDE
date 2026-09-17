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

type MarkdownFence = Readonly<{
  length: number;
  marker: '`' | '~';
}>;

const DOCUMENT_STATS_IGNORED_CHARACTERS = new Set([
  '#',
  '*',
  '_',
  '~',
  '`',
  '>',
  '|',
  '(',
  ')',
  '[',
  ']'
]);

function isDocumentStatsWhitespace(code: number): boolean {
  return (
    (code >= 0x0009 && code <= 0x000d)
    || 0x0020 === code
    || 0x00a0 === code
    || 0x1680 === code
    || (code >= 0x2000 && code <= 0x200a)
    || 0x2028 === code
    || 0x2029 === code
    || 0x202f === code
    || 0x205f === code
    || 0x3000 === code
    || 0xfeff === code
  );
}

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

type MutableDocumentDerivations = {
  characters: number;
  index: number;
  outline: ImmersiveOutlineItem[];
  words: number;
};

type MutableDocumentLine = {
  characters: number;
  fenceInvalid: boolean;
  fenceLeadingSpaces: number;
  fenceMarker: MarkdownFence['marker'] | null;
  fenceRunEnded: boolean;
  fenceRunLength: number;
  fenceSuffixHasBacktick: boolean;
  fenceSuffixHasLineTerminator: boolean;
  fenceSuffixOnlyWhitespace: boolean;
  headingHashes: number;
  headingLeadingSpaces: number;
  headingPhase: 'leading' | 'hashes' | 'tail' | 'invalid';
  headingClosingHashCount: number;
  headingClosingHashStart: number | null;
  headingClosingState: 'none' | 'whitespace' | 'hashes' | 'trailing';
  headingBodyFirstNonWhitespace: number | null;
  headingBodyLastNonWhitespaceEnd: number;
  headingTailChunkStart: number | null;
  headingTailChunks: string[];
  headingTailLength: number;
  insideFence: boolean;
  insideWord: boolean;
  words: number;
};

function createMutableDocumentLine(insideFence: boolean): MutableDocumentLine {
  return {
    characters: 0,
    fenceInvalid: false,
    fenceLeadingSpaces: 0,
    fenceMarker: null,
    fenceRunEnded: false,
    fenceRunLength: 0,
    fenceSuffixHasBacktick: false,
    fenceSuffixHasLineTerminator: false,
    fenceSuffixOnlyWhitespace: true,
    headingHashes: 0,
    headingLeadingSpaces: 0,
    headingPhase: 'leading',
    headingClosingHashCount: 0,
    headingClosingHashStart: null,
    headingClosingState: 'none',
    headingBodyFirstNonWhitespace: null,
    headingBodyLastNonWhitespaceEnd: 0,
    headingTailChunkStart: null,
    headingTailChunks: [],
    headingTailLength: 0,
    insideFence,
    insideWord: false,
    words: 0
  };
}

function isMarkdownRegexLineTerminator(character: string): boolean {
  return '\r' === character || '\u2028' === character || '\u2029' === character;
}

function observeDocumentFenceCharacter(
  line: MutableDocumentLine,
  character: string
): void {
  if (line.fenceInvalid) return;

  if (null === line.fenceMarker) {
    if (' ' === character && line.fenceLeadingSpaces < 3) {
      line.fenceLeadingSpaces += 1;
      return;
    }
    if ('`' === character || '~' === character) {
      line.fenceMarker = character;
      line.fenceRunLength = 1;
      return;
    }
    line.fenceInvalid = true;
    return;
  }

  if (!line.fenceRunEnded) {
    if (character === line.fenceMarker) {
      line.fenceRunLength += 1;
      return;
    }
    line.fenceRunEnded = true;
  }

  if ('`' === character) line.fenceSuffixHasBacktick = true;
  if (isMarkdownRegexLineTerminator(character)) {
    line.fenceSuffixHasLineTerminator = true;
  }
  if (' ' !== character && '\t' !== character) {
    line.fenceSuffixOnlyWhitespace = false;
  }
}

function observeDocumentHeadingCharacter(
  line: MutableDocumentLine,
  character: string,
  sourcePosition: number
): void {
  if ('leading' === line.headingPhase) {
    if (' ' === character && line.headingLeadingSpaces < 3) {
      line.headingLeadingSpaces += 1;
      return;
    }
    if ('#' === character) {
      line.headingHashes = 1;
      line.headingPhase = 'hashes';
      return;
    }
    line.headingPhase = 'invalid';
    return;
  }

  if ('tail' === line.headingPhase) {
    observeDocumentHeadingTailCharacter(line, character);
    return;
  }
  if ('hashes' !== line.headingPhase) return;
  if ('#' === character) {
    if (line.headingHashes >= 6) line.headingPhase = 'invalid';
    else line.headingHashes += 1;
    return;
  }
  if (' ' === character || '\t' === character) {
    line.headingTailChunkStart = sourcePosition;
    line.headingPhase = 'tail';
    observeDocumentHeadingTailCharacter(line, character);
    return;
  }
  line.headingPhase = 'invalid';
}

function markDocumentHeadingBodyRange(
  line: MutableDocumentLine,
  start: number,
  end: number
): void {
  if (start >= end) return;
  line.headingBodyFirstNonWhitespace ??= start;
  line.headingBodyLastNonWhitespaceEnd = Math.max(
    line.headingBodyLastNonWhitespaceEnd,
    end
  );
}

function markDocumentHeadingBodyCharacter(
  line: MutableDocumentLine,
  character: string,
  offset: number
): void {
  if (isDocumentStatsWhitespace(character.charCodeAt(0))) return;
  markDocumentHeadingBodyRange(line, offset, offset + 1);
}

function commitDocumentHeadingClosingCandidate(
  line: MutableDocumentLine
): void {
  if (
    ('hashes' === line.headingClosingState
      || 'trailing' === line.headingClosingState)
    && null !== line.headingClosingHashStart
  ) {
    markDocumentHeadingBodyRange(
      line,
      line.headingClosingHashStart,
      line.headingClosingHashStart + line.headingClosingHashCount
    );
  }
  line.headingClosingHashCount = 0;
  line.headingClosingHashStart = null;
  line.headingClosingState = 'none';
}

function observeDocumentHeadingTailCharacter(
  line: MutableDocumentLine,
  character: string
): void {
  if (isMarkdownRegexLineTerminator(character)) {
    line.headingPhase = 'invalid';
    return;
  }

  const offset = line.headingTailLength;
  line.headingTailLength += 1;
  if (' ' === character || '\t' === character) {
    if ('none' === line.headingClosingState) {
      line.headingClosingState = 'whitespace';
    } else if ('hashes' === line.headingClosingState) {
      line.headingClosingState = 'trailing';
    }
    return;
  }
  if ('#' === character) {
    if ('whitespace' === line.headingClosingState) {
      line.headingClosingHashCount = 1;
      line.headingClosingHashStart = offset;
      line.headingClosingState = 'hashes';
      return;
    }
    if ('hashes' === line.headingClosingState) {
      line.headingClosingHashCount += 1;
      return;
    }
    if ('trailing' === line.headingClosingState) {
      commitDocumentHeadingClosingCandidate(line);
      line.headingClosingHashStart = offset;
      line.headingClosingHashCount = 1;
      line.headingClosingState = 'hashes';
      return;
    }
    markDocumentHeadingBodyCharacter(line, character, offset);
    return;
  }
  if ('none' !== line.headingClosingState) {
    commitDocumentHeadingClosingCandidate(line);
  }
  markDocumentHeadingBodyCharacter(line, character, offset);
}

function flushDocumentHeadingChunk(
  line: MutableDocumentLine,
  markdown: string,
  end: number
): void {
  if (
    'tail' !== line.headingPhase
    || null === line.headingTailChunkStart
    || end <= line.headingTailChunkStart
  ) return;
  line.headingTailChunks.push(
    markdown.slice(line.headingTailChunkStart, end)
  );
  line.headingTailChunkStart = end;
}

function buildDocumentHeadingText(line: MutableDocumentLine): string {
  if (
    null === line.headingBodyFirstNonWhitespace
    || line.headingBodyLastNonWhitespaceEnd <= line.headingBodyFirstNonWhitespace
  ) return '';
  const textStart = line.headingBodyFirstNonWhitespace;
  const textEnd = line.headingBodyLastNonWhitespaceEnd;
  let skip = textStart;
  let remaining = textEnd - textStart;
  const chunks: string[] = [];
  for (const chunk of line.headingTailChunks) {
    if (skip >= chunk.length) {
      skip -= chunk.length;
      continue;
    }
    const chunkStart = skip;
    const chunkLength = Math.min(chunk.length - chunkStart, remaining);
    chunks.push(chunk.slice(chunkStart, chunkStart + chunkLength));
    remaining -= chunkLength;
    skip = 0;
    if (remaining <= 0) break;
  }
  return chunks.join('');
}

function accumulateDocumentCharacter(
  line: MutableDocumentLine,
  character: string
): void {
  if (DOCUMENT_STATS_IGNORED_CHARACTERS.has(character)) return;
  if (isDocumentStatsWhitespace(character.charCodeAt(0))) {
    line.insideWord = false;
    return;
  }
  line.characters += 1;
  if (!line.insideWord) {
    line.words += 1;
    line.insideWord = true;
  }
}

function lineFence(line: MutableDocumentLine): MarkdownFence | null {
  if (
    line.fenceInvalid
    || null === line.fenceMarker
    || line.fenceRunLength < 3
    || ('`' === line.fenceMarker && line.fenceSuffixHasBacktick)
    || line.fenceSuffixHasLineTerminator
  ) {
    return null;
  }
  return { length: line.fenceRunLength, marker: line.fenceMarker };
}

function finalizeDocumentLine(
  state: MutableDocumentDerivations,
  line: MutableDocumentLine,
  lineNumber: number,
  linePosition: number,
  fence: MarkdownFence | null
): MarkdownFence | null {
  const candidate = lineFence(line);
  if (line.insideFence) {
    if (
      fence
      && candidate
      && candidate.marker === fence.marker
      && candidate.length >= fence.length
      && line.fenceSuffixOnlyWhitespace
    ) {
      return null;
    }
    return fence;
  }

  if (candidate) return candidate;

  state.characters += line.characters;
  state.words += line.words;
  if ('hashes' !== line.headingPhase && 'tail' !== line.headingPhase) {
    return null;
  }

  const text = buildDocumentHeadingText(line);
  if (!text) return null;

  state.outline.push({
    level: line.headingHashes,
    text,
    line: lineNumber,
    position: linePosition,
    index: state.index++
  });
  return null;
}

export type ImmersiveDocumentDerivationScanner = Readonly<{
  advance: (characterBudget: number) => boolean;
  result: () => ImmersiveDocumentDerivations;
}>;

export function createDocumentDerivationScanner(
  markdown: string
): ImmersiveDocumentDerivationScanner {
  let fence: MarkdownFence | null = null;
  let position = 0;
  let lineNumber = 0;
  let linePosition = 0;
  let pendingCarriageReturn = false;
  let line = createMutableDocumentLine(false);
  let done = false;
  const state: MutableDocumentDerivations = {
    characters: 0,
    index: 0,
    outline: [],
    words: 0
  };

  return {
    advance(characterBudget: number): boolean {
      if (!Number.isInteger(characterBudget) || characterBudget < 1) {
        throw new Error('immersive-document-scan-budget-invalid');
      }
      if (done) return true;
      const sliceStart = position;
      while (
        position < markdown.length
        && position - sliceStart < characterBudget
      ) {
        const sourcePosition = position;
        const character = markdown.charAt(position);
        position += 1;

        if ('\r' === character) {
          pendingCarriageReturn = true;
          continue;
        }
        if ('\n' === character) {
          const lineContentEnd = pendingCarriageReturn
            ? sourcePosition - 1
            : sourcePosition;
          flushDocumentHeadingChunk(line, markdown, lineContentEnd);
          pendingCarriageReturn = false;
          fence = finalizeDocumentLine(
            state,
            line,
            lineNumber,
            linePosition,
            fence
          );
          lineNumber += 1;
          linePosition = sourcePosition + 1;
          line = createMutableDocumentLine(null !== fence);
          continue;
        }

        if (pendingCarriageReturn) {
          accumulateDocumentCharacter(line, '\r');
          observeDocumentFenceCharacter(line, '\r');
          if (!line.insideFence) {
            observeDocumentHeadingCharacter(
              line,
              '\r',
              sourcePosition - 1
            );
          }
          pendingCarriageReturn = false;
        }

        observeDocumentFenceCharacter(line, character);
        if (!line.insideFence) {
          accumulateDocumentCharacter(line, character);
          observeDocumentHeadingCharacter(line, character, sourcePosition);
        }
      }

      flushDocumentHeadingChunk(
        line,
        markdown,
        pendingCarriageReturn ? position - 1 : position
      );
      if (position < markdown.length) return false;

      const lineContentEnd = pendingCarriageReturn
        ? markdown.length - 1
        : markdown.length;
      pendingCarriageReturn = false;
      flushDocumentHeadingChunk(line, markdown, lineContentEnd);
      fence = finalizeDocumentLine(
        state,
        line,
        lineNumber,
        linePosition,
        fence
      );
      lineNumber += 1;
      done = true;
      return done;
    },
    result(): ImmersiveDocumentDerivations {
      if (!done) throw new Error('immersive-document-scan-incomplete');
      return {
        outline: state.outline,
        stats: {
          words: state.words,
          characters: state.characters,
          minutes: Math.max(1, Math.ceil(state.words / 200))
        }
      };
    }
  };
}

export type ImmersiveDocumentDerivations = Readonly<{
  outline: ImmersiveOutlineItem[];
  stats: DocumentStats;
}>;

export function deriveDocumentDerivations(
  markdown: string
): ImmersiveDocumentDerivations {
  const scanner = createDocumentDerivationScanner(markdown);
  scanner.advance(Number.MAX_SAFE_INTEGER);
  return scanner.result();
}

export function getDocumentStats(markdown: string): DocumentStats {
  return deriveDocumentDerivations(markdown).stats;
}

export function extractOutline(markdown: string): ImmersiveOutlineItem[] {
  return deriveDocumentDerivations(markdown).outline;
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
