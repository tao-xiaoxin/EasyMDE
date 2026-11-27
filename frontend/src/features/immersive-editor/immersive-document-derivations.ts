/**
 * Streaming document statistics and heading outline derivations for the
 * immersive editor. The scanner advances in bounded character slices so a
 * long document never blocks one frame.
 */

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
